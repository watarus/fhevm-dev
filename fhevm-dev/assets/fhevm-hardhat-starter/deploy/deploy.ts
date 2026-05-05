import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedFHECounter = await deploy("FHECounter", {
    from: deployer,
    log: true,
  });
  console.log(`FHECounter contract: `, deployedFHECounter.address);

  const deployedConfidentialPayroll = await deploy("ConfidentialPayroll", {
    from: deployer,
    log: true,
  });
  console.log(`ConfidentialPayroll contract: `, deployedConfidentialPayroll.address);
};
export default func;
func.id = "deploy_starter_contracts"; // id required to prevent reexecution
func.tags = ["FHECounter", "ConfidentialPayroll"];
