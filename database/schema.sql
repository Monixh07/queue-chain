CREATE DATABASE IF NOT EXISTS queuechain CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE queuechain;

CREATE TABLE IF NOT EXISTS admins (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('ADMIN') NOT NULL DEFAULT 'ADMIN',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admins_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(120) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(254) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_users_phone (phone)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS queue_sessions (
  queue_date DATE NOT NULL,
  last_token_number INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (queue_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bookings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_uuid CHAR(36) NOT NULL,
  idempotency_key CHAR(36) NOT NULL,
  daily_token_number INT UNSIGNED NOT NULL,
  blockchain_booking_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  booking_source ENUM('ONLINE', 'OFFLINE') NOT NULL,
  service_required VARCHAR(100) NOT NULL,
  status ENUM('WAITING', 'CALLED', 'VERIFIED', 'COMPLETED', 'SKIPPED') NOT NULL DEFAULT 'WAITING',
  booking_timestamp DATETIME NOT NULL,
  blockchain_transaction_hash CHAR(66) NOT NULL,
  queue_date DATE NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bookings_uuid (booking_uuid),
  UNIQUE KEY uq_bookings_idempotency (idempotency_key),
  UNIQUE KEY uq_bookings_chain_id (blockchain_booking_id),
  UNIQUE KEY uq_bookings_daily_token (queue_date, daily_token_number),
  KEY idx_bookings_queue (queue_date, status, daily_token_number),
  CONSTRAINT fk_bookings_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_bookings_queue_session FOREIGN KEY (queue_date) REFERENCES queue_sessions(queue_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS queue_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_uuid CHAR(36) NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  event_description VARCHAR(600) NOT NULL,
  admin_id BIGINT UNSIGNED NULL,
  transaction_hash CHAR(66) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_queue_events_booking (booking_uuid, created_at),
  KEY idx_queue_events_tx (transaction_hash),
  CONSTRAINT fk_queue_events_booking FOREIGN KEY (booking_uuid) REFERENCES bookings(booking_uuid),
  CONSTRAINT fk_queue_events_admin FOREIGN KEY (admin_id) REFERENCES admins(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_activity (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(48) NOT NULL,
  booking_uuid CHAR(36) NULL,
  transaction_hash CHAR(66) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_admin_activity_admin (admin_id, created_at),
  CONSTRAINT fk_admin_activity_admin FOREIGN KEY (admin_id) REFERENCES admins(id),
  CONSTRAINT fk_admin_activity_booking FOREIGN KEY (booking_uuid) REFERENCES bookings(booking_uuid)
) ENGINE=InnoDB;
