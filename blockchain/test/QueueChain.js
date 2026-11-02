const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('QueueChain', function () {
  async function deploy() {
    const [admin, stranger] = await ethers.getSigners();
    const contract = await ethers.deployContract('QueueChain', [admin.address]);
    return { contract, admin, stranger };
  }

  it('allocates one sequential queue for online and offline bookings', async function () {
    const { contract } = await deploy();
    const first = ethers.id('online-request');
    const second = ethers.id('offline-request');
    const receipt = await (await contract.createBooking(first, 0)).wait();
    const event = receipt.logs.map((log) => {
      try { return contract.interface.parseLog(log); } catch { return null; }
    }).find((parsed) => parsed?.name === 'BookingCreated');
    expect(event.args.bookingId).to.equal(1);
    expect(event.args.dailyTokenNumber).to.equal(1);
    expect(event.args.source).to.equal(0);
    expect(event.args.requestId).to.equal(first);
    await contract.createBooking(second, 1);
    const firstBooking = await contract.getBooking(1);
    const secondBooking = await contract.getBooking(2);
    expect(firstBooking[1]).to.equal(1);
    expect(secondBooking[1]).to.equal(2);
    expect(secondBooking[2]).to.equal(1);
  });

  it('resets visible token numbers by UTC day while keeping booking IDs global', async function () {
    const { contract } = await deploy();
    await contract.createBooking(ethers.id('day-one'), 0);
    const timestamp = (await ethers.provider.getBlock('latest')).timestamp;
    await ethers.provider.send('evm_setNextBlockTimestamp', [timestamp + 24 * 60 * 60]);
    await contract.createBooking(ethers.id('day-two'), 1);
    expect((await contract.getBooking(1))[1]).to.equal(1);
    expect((await contract.getBooking(2))[1]).to.equal(1);
    expect(await contract.nextBookingId()).to.equal(3);
  });

  it('prevents duplicates, unauthorized changes, and multiple active tokens', async function () {
    const { contract, stranger } = await deploy();
    const requestId = ethers.id('unique');
    await contract.createBooking(requestId, 0);
    await expect(contract.createBooking(requestId, 0)).to.be.revertedWithCustomError(contract, 'DuplicateRequest');
    await expect(contract.connect(stranger).callNext()).to.be.reverted;
    await contract.callNext();
    await expect(contract.callNext()).to.be.revertedWithCustomError(contract, 'ActiveTokenExists');
  });

  it('requires verification before completion and preserves skipped history', async function () {
    const { contract } = await deploy();
    await contract.createBooking(ethers.id('first'), 0);
    await contract.createBooking(ethers.id('second'), 1);
    await expect(contract.completeCurrent()).to.be.revertedWithCustomError(contract, 'NoActiveToken');
    await contract.callNext();
    await expect(contract.completeCurrent()).to.be.revertedWithCustomError(contract, 'InvalidStatus');
    await contract.skipCurrent(ethers.id('no-show'));
    expect((await contract.getBooking(1))[3]).to.equal(4);
    await contract.callNext();
    await contract.markVerified(2);
    await contract.completeCurrent();
    expect((await contract.getBooking(2))[3]).to.equal(3);
    expect(await contract.nextBookingId()).to.equal(3);
  });
});
