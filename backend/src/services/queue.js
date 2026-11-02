import { randomUUID } from 'node:crypto';
import { pool } from '../database/pool.js';
import * as chain from './blockchain.js';

const privateColumns = `b.booking_uuid AS bookingUuid, b.daily_token_number AS dailyTokenNumber,
  u.full_name AS fullName, RIGHT(u.phone, 4) AS phoneLastFour, u.phone AS privatePhone,
  b.booking_source AS bookingSource, b.service_required AS serviceRequired,
  b.status, b.booking_timestamp AS bookingTimestamp, b.blockchain_transaction_hash AS transactionHash`;

const publicColumns = `b.booking_uuid AS bookingUuid, b.daily_token_number AS dailyTokenNumber,
  b.service_required AS serviceRequired, b.status`;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function cleanBooking(row, privateData = false) {
  if (!row) return null;
  const result = { ...row };
  delete result.privatePhone;
  if (!privateData) {
    delete result.fullName;
    delete result.phoneLastFour;
    delete result.bookingSource;
    delete result.bookingTimestamp;
    delete result.transactionHash;
  }
  return result;
}

async function getActive(connection = pool) {
  const [rows] = await connection.query(
    `SELECT ${privateColumns} FROM bookings b JOIN users u ON u.id = b.user_id
     WHERE b.queue_date = ? AND b.status IN ('CALLED', 'VERIFIED') LIMIT 1`,
    [today()],
  );
  return rows[0] || null;
}

export async function getPublicQueue() {
  const [current, upcomingResult, statsResult] = await Promise.all([
    getActive(),
    pool.query(`SELECT ${publicColumns} FROM bookings b WHERE b.queue_date = ? AND b.status = 'WAITING'
      ORDER BY b.daily_token_number ASC LIMIT 8`, [today()]),
    pool.query(`SELECT COUNT(*) AS waiting FROM bookings WHERE queue_date = ? AND status = 'WAITING'`, [today()]),
  ]);
  return {
    current: cleanBooking(current),
    upcoming: upcomingResult[0],
    stats: { waiting: Number(statsResult[0][0].waiting || 0) },
    date: today(),
  };
}

export async function dashboard() {
  const day = today();
  const [[bookings], [counts]] = await Promise.all([
    pool.query(`SELECT ${privateColumns} FROM bookings b JOIN users u ON u.id = b.user_id
      WHERE b.queue_date = ? ORDER BY b.daily_token_number ASC`, [day]),
    pool.query(`SELECT COUNT(*) AS total,
      SUM(status = 'WAITING') AS waiting, SUM(status = 'VERIFIED') AS verified,
      SUM(status = 'COMPLETED') AS completed, SUM(status = 'SKIPPED') AS skipped
      FROM bookings WHERE queue_date = ?`, [day]),
  ]);
  const current = await getActive();
  const upcoming = bookings.filter((booking) => booking.status === 'WAITING').slice(0, 8).map(cleanBooking);
  return {
    current: cleanBooking(current, true),
    upcoming,
    bookings: bookings.map((booking) => cleanBooking(booking, true)),
    stats: { ...counts, waiting: Number(counts.waiting || 0), total: Number(counts.total || 0),
      verified: Number(counts.verified || 0), completed: Number(counts.completed || 0), skipped: Number(counts.skipped || 0) },
    date: day,
  };
}

export async function createBooking(input, source, adminId = null) {
  const requestId = input.requestId || randomUUID();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(`INSERT IGNORE INTO queue_sessions (queue_date, last_token_number) VALUES (?, 0)`, [today()]);
    await connection.query(`SELECT queue_date FROM queue_sessions WHERE queue_date = ? FOR UPDATE`, [today()]);

    const [existing] = await connection.query(
      `SELECT b.daily_token_number AS dailyTokenNumber, b.booking_uuid AS bookingUuid, b.status,
        b.blockchain_transaction_hash AS transactionHash, b.booking_source AS bookingSource
       FROM bookings b WHERE b.idempotency_key = ? LIMIT 1`, [requestId],
    );
    if (existing.length) {
      if (existing[0].bookingSource !== source) throw new Error('This request ID is already bound to a different booking source.');
      await connection.commit();
      return { ...existing[0], duplicate: true };
    }

    const bookingUuid = randomUUID();
    let booking;
    try {
      booking = await chain.createBooking(requestId, source);
    } catch (error) {
      booking = await chain.findBooking(requestId);
      if (!booking) throw error;
      if (booking.source !== source) throw new Error('This request ID is already bound to a different booking source.');
    }
    const [userResult] = await connection.query(
      `INSERT INTO users (full_name, phone, email) VALUES (?, ?, ?)`,
      [input.fullName.trim(), input.phone.trim(), input.email?.trim() || null],
    );
    await connection.query(
      `INSERT INTO bookings
        (booking_uuid, idempotency_key, daily_token_number, blockchain_booking_id, user_id,
         booking_source, service_required, status, booking_timestamp, blockchain_transaction_hash, queue_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'WAITING', UTC_TIMESTAMP(), ?, ?)`,
      [bookingUuid, requestId, booking.dailyTokenNumber, booking.bookingId, userResult.insertId,
        source, input.serviceRequired.trim(), booking.transactionHash, today()],
    );
    await connection.query(`UPDATE queue_sessions SET last_token_number = ? WHERE queue_date = ?`,
      [booking.dailyTokenNumber, today()]);
    await connection.query(
      `INSERT INTO queue_events (booking_uuid, event_type, event_description, admin_id, transaction_hash)
       VALUES (?, 'BOOKING_CREATED', ?, ?, ?)`,
      [bookingUuid, `Booking created from ${source.toLowerCase()} portal`, adminId, booking.transactionHash],
    );
    if (adminId) {
      await connection.query(`INSERT INTO admin_activity (admin_id, action, booking_uuid, transaction_hash)
        VALUES (?, 'OFFLINE_BOOKING_CREATED', ?, ?)`, [adminId, bookingUuid, booking.transactionHash]);
    }
    await connection.commit();
    return { bookingUuid, dailyTokenNumber: booking.dailyTokenNumber, status: 'WAITING', transactionHash: booking.transactionHash };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function lockedQueueAction(adminId, action) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(`INSERT IGNORE INTO queue_sessions (queue_date, last_token_number) VALUES (?, 0)`, [today()]);
    await connection.query(`SELECT queue_date FROM queue_sessions WHERE queue_date = ? FOR UPDATE`, [today()]);
    const result = await action(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function recordAction(connection, booking, eventType, description, adminId, transactionHash, status) {
  await connection.query(`UPDATE bookings SET status = ? WHERE booking_uuid = ?`, [status, booking.bookingUuid]);
  await connection.query(`INSERT INTO queue_events (booking_uuid, event_type, event_description, admin_id, transaction_hash)
    VALUES (?, ?, ?, ?, ?)`, [booking.bookingUuid, eventType, description, adminId, transactionHash]);
  if (adminId) {
    await connection.query(`INSERT INTO admin_activity (admin_id, action, booking_uuid, transaction_hash)
      VALUES (?, ?, ?, ?)`, [adminId, eventType, booking.bookingUuid, transactionHash]);
  }
}

export async function callNext(adminId) {
  return lockedQueueAction(adminId, async (connection) => {
    if (await getActive(connection)) throw new Error('A token is already active. Complete or skip it first.');
    const activeBlockchainId = await chain.getCurrentBookingId();
    let next;
    let alreadyCalled = false;
    if (activeBlockchainId !== 0n) {
      const [rows] = await connection.query(`SELECT ${privateColumns}, b.blockchain_booking_id AS blockchainBookingId
        FROM bookings b JOIN users u ON u.id = b.user_id
        WHERE b.queue_date = ? AND b.blockchain_booking_id = ? LIMIT 1`,
      [today(), activeBlockchainId.toString()]);
      next = rows[0];
      if (!next || !['WAITING', 'CALLED'].includes(next.status)) {
        throw new Error('The active blockchain token does not match an eligible database booking.');
      }
      const [earlier] = await connection.query(`SELECT COUNT(*) AS count FROM bookings
        WHERE queue_date = ? AND daily_token_number < ? AND status = 'WAITING'`,
      [today(), next.dailyTokenNumber]);
      if (Number(earlier[0].count) > 0) throw new Error('Blockchain and database queue order are inconsistent; reconcile before continuing.');
      alreadyCalled = true;
    } else {
      const [rows] = await connection.query(`SELECT ${privateColumns}, b.blockchain_booking_id AS blockchainBookingId
        FROM bookings b JOIN users u ON u.id = b.user_id
        WHERE b.queue_date = ? AND b.status = 'WAITING' ORDER BY b.daily_token_number LIMIT 1`, [today()]);
      next = rows[0];
    }
    if (!next) throw new Error('There are no waiting visitors.');
    if (!alreadyCalled) {
      const receipt = await chain.callNext();
      await recordAction(connection, next, 'TOKEN_CALLED', 'Token called by administrator', adminId, receipt.hash, 'CALLED');
      return { message: `Token ${String(next.dailyTokenNumber).padStart(3, '0')} is now being called.`, transactionHash: receipt.hash };
    }
    const onChain = await chain.getBookingState(next.blockchainBookingId);
    if (onChain.status !== 1) throw new Error('The active blockchain token has an unexpected status.');
    await recordAction(connection, next, 'TOKEN_CALLED', 'Token call reconciled from blockchain', adminId, onChain.transactionHash, 'CALLED');
    return { message: `Token ${String(next.dailyTokenNumber).padStart(3, '0')} is now being called.`, transactionHash: onChain.transactionHash };
  });
}

export async function verifyCurrent(phone) {
  return lockedQueueAction(null, async (connection) => {
    const current = await getActive(connection);
    if (!current || current.status !== 'CALLED') throw new Error('There is no unverified token currently being called.');
    const normalize = (value) => value.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    if (normalize(current.privatePhone) !== normalize(phone)) throw new Error('That phone number does not match the current booking.');
    const bookingId = await getBlockchainBookingId(connection, current.bookingUuid);
    const onChain = await chain.getBookingState(bookingId);
    const transactionHash = onChain.status === 2
      ? onChain.transactionHash
      : (onChain.status === 1 ? (await chain.markVerified(bookingId)).hash : null);
    if (!transactionHash) throw new Error('The current blockchain token cannot be verified in its present state.');
    await recordAction(connection, current, 'TOKEN_VERIFIED', 'Current visitor verified by registered phone', null, transactionHash, 'VERIFIED');
    return { message: 'Visitor verified successfully.' };
  });
}

async function getBlockchainBookingId(connection, bookingUuid) {
  const [rows] = await connection.query(`SELECT blockchain_booking_id AS bookingId FROM bookings WHERE booking_uuid = ?`, [bookingUuid]);
  if (!rows[0]) throw new Error('Booking record was not found.');
  return rows[0].bookingId;
}

export async function skipCurrent(adminId, reason) {
  return lockedQueueAction(adminId, async (connection) => {
    const current = await getActive(connection);
    if (!current || current.status !== 'CALLED') throw new Error('Only a called, unverified token can be skipped.');
    const bookingId = await getBlockchainBookingId(connection, current.bookingUuid);
    const reasonHash = chain.reasonCommitment(reason);
    const onChain = await chain.getBookingState(bookingId);
    let transactionHash;
    if (onChain.status === 4) {
      if (onChain.reasonCommitment !== reasonHash) throw new Error('The reason does not match the already-recorded skip.');
      transactionHash = onChain.transactionHash;
    } else if (onChain.status === 1) {
      transactionHash = (await chain.skipCurrent(reasonHash)).hash;
    } else {
      throw new Error('The current blockchain token cannot be skipped in its present state.');
    }
    await recordAction(connection, current, 'TOKEN_SKIPPED', `Token skipped: ${reason}`, adminId, transactionHash, 'SKIPPED');
    return { message: `Token ${String(current.dailyTokenNumber).padStart(3, '0')} was skipped.`, transactionHash, bookingId };
  });
}

export async function completeCurrent(adminId) {
  return lockedQueueAction(adminId, async (connection) => {
    const current = await getActive(connection);
    if (!current || current.status !== 'VERIFIED') throw new Error('Only the verified current token can be completed.');
    const bookingId = await getBlockchainBookingId(connection, current.bookingUuid);
    const onChain = await chain.getBookingState(bookingId);
    const transactionHash = onChain.status === 3
      ? onChain.transactionHash
      : (onChain.status === 2 ? (await chain.completeCurrent()).hash : null);
    if (!transactionHash) throw new Error('The current blockchain token cannot be completed in its present state.');
    await recordAction(connection, current, 'TOKEN_COMPLETED', 'Service completed', adminId, transactionHash, 'COMPLETED');
    return { message: `Token ${String(current.dailyTokenNumber).padStart(3, '0')} is complete.`, transactionHash };
  });
}

export async function blockchainHistory() {
  const [events] = await pool.query(`SELECT e.event_type AS eventType, b.daily_token_number AS dailyTokenNumber,
      e.event_description AS description, e.transaction_hash AS transactionHash, e.created_at AS createdAt
    FROM queue_events e LEFT JOIN bookings b ON b.booking_uuid = e.booking_uuid
    WHERE e.transaction_hash IS NOT NULL ORDER BY e.id DESC LIMIT 100`);
  return events;
}

export async function health() {
  await pool.query('SELECT 1');
  const network = await chain.getBlockchainHealth();
  return { database: 'connected', blockchain: network };
}
