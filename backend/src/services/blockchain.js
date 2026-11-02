import { Contract, JsonRpcProvider, Wallet, id } from 'ethers';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from '../config.js';

const artifactPath = fileURLToPath(new URL('../../../blockchain/artifacts/contracts/QueueChain.sol/QueueChain.json', import.meta.url));

async function contract() {
  if (!config.contractAddress || !config.privateKey) {
    throw new Error('Blockchain is not configured. Deploy QueueChain and set QUEUECHAIN_CONTRACT_ADDRESS and BLOCKCHAIN_PRIVATE_KEY.');
  }
  const artifact = JSON.parse(await readFile(path.resolve(artifactPath), 'utf8'));
  const provider = new JsonRpcProvider(config.rpcUrl);
  const wallet = new Wallet(config.privateKey, provider);
  const instance = new Contract(config.contractAddress, artifact.abi, wallet);
  const code = await provider.getCode(config.contractAddress);
  if (code === '0x') throw new Error(`No smart contract is deployed at ${config.contractAddress}.`);
  return instance;
}

async function waitForTransaction(transaction) {
  const receipt = await transaction.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error('Blockchain transaction was not confirmed.');
  return receipt;
}

export async function createBooking(requestId, source) {
  const instance = await contract();
  const requestHash = id(requestId);
  const transaction = await instance.createBooking(requestHash, source === 'OFFLINE' ? 1 : 0);
  const receipt = await waitForTransaction(transaction);
  const event = receipt.logs.map((log) => {
    try { return instance.interface.parseLog(log); } catch { return null; }
  }).find((parsed) => parsed?.name === 'BookingCreated');
  if (!event) throw new Error('Booking transaction was confirmed without a BookingCreated event.');
  return {
    bookingId: event.args.bookingId.toString(),
    dailyTokenNumber: Number(event.args.dailyTokenNumber),
    transactionHash: receipt.hash,
  };
}

export async function findBooking(requestId) {
  const instance = await contract();
  const requestHash = id(requestId);
  const bookingId = await instance.bookingForRequest(requestHash);
  if (bookingId === 0n) return null;
  const [queueDay, dailyTokenNumber, source] = await instance.getBooking(bookingId);
  const events = await instance.queryFilter(instance.filters.BookingCreated(null, null, null, null, requestHash));
  const event = events.find((entry) => entry.args.bookingId === bookingId);
  if (!event) throw new Error('Existing on-chain booking is missing its creation event.');
  return {
    bookingId: bookingId.toString(),
    dailyTokenNumber: Number(dailyTokenNumber),
    source: Number(source) === 1 ? 'OFFLINE' : 'ONLINE',
    queueDay: Number(queueDay),
    transactionHash: event.transactionHash,
  };
}

export async function callNext() {
  const instance = await contract();
  return waitForTransaction(await instance.callNext());
}

export async function markVerified(bookingId) {
  const instance = await contract();
  return waitForTransaction(await instance.markVerified(bookingId));
}

export async function skipCurrent(reasonHash) {
  const instance = await contract();
  return waitForTransaction(await instance.skipCurrent(reasonHash));
}

export async function completeCurrent() {
  const instance = await contract();
  return waitForTransaction(await instance.completeCurrent());
}

export async function getBookingState(bookingId) {
  const instance = await contract();
  const [, dailyTokenNumber, , status] = await instance.getBooking(bookingId);
  const statusNumber = Number(status);
  const eventNames = ['BookingCreated', 'TokenCalled', 'TokenVerified', 'TokenCompleted', 'TokenSkipped'];
  const eventName = eventNames[statusNumber];
  if (!eventName) throw new Error(`Unknown on-chain booking status ${statusNumber}.`);
  const events = await instance.queryFilter(instance.filters[eventName](bookingId));
  const latest = events.at(-1);
  if (!latest) throw new Error(`On-chain ${eventName} event is missing for booking ${bookingId}.`);
  const state = {
    status: statusNumber,
    dailyTokenNumber: Number(dailyTokenNumber),
    transactionHash: latest.transactionHash,
  };
  if (statusNumber === 4) {
    state.reasonCommitment = await instance.skipReasonCommitment(bookingId);
  }
  return state;
}

export async function getCurrentBookingId() {
  const instance = await contract();
  const [, bookingId] = await instance.getQueueStatus();
  return bookingId;
}

export async function getBlockchainHealth() {
  const instance = await contract();
  const network = await instance.runner.provider.getNetwork();
  return { chainId: network.chainId.toString(), contractAddress: config.contractAddress, admin: await instance.runner.getAddress() };
}

export function reasonCommitment(reason) {
  return id(reason);
}
