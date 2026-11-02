const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const queueChain = await hre.ethers.deployContract('QueueChain', [deployer.address]);
  await queueChain.waitForDeployment();
  const address = await queueChain.getAddress();
  console.log(`QueueChain deployed to: ${address}`);
  console.log(`Administrator/operator wallet: ${deployer.address}`);
  console.log(`Set QUEUECHAIN_CONTRACT_ADDRESS=${address} in backend/.env`);
  console.log('Use the private key for this same local Hardhat account as BLOCKCHAIN_PRIVATE_KEY.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
