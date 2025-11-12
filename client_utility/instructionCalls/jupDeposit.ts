import * as anchor from "@coral-xyz/anchor";
import { YieldAggregator } from "../../target/types/yield_aggregator";


export async function jupDeposit(
  program : anchor.Program<YieldAggregator>,
  provider : anchor.AnchorProvider,
  depositAmount : anchor.BN,
  accounts : {
    admin : anchor.web3.Keypair,
    usdcMint : anchor.web3.PublicKey,
}){
  const { getDepositContext } = await import("@jup-ag/lend/earn");
  
  const jupDepositContext = await getDepositContext({
    asset: accounts.usdcMint,
    connection: provider.connection,
    signer: accounts.admin.publicKey,
  });

  const tx = await program.methods
    .jupDeposit(depositAmount.sub(new anchor.BN(50)))
    .accounts({
      admin: accounts.admin.publicKey,
      usdcMint: accounts.usdcMint,
      fTokenMint: jupDepositContext.fTokenMint,
      lendingAdmin: jupDepositContext.lendingAdmin,
      lending: jupDepositContext.lending,
      supplyTokenReservesLiquidity: jupDepositContext.supplyTokenReservesLiquidity,
      lendingSupplyPositionOnLiquidity: jupDepositContext.lendingSupplyPositionOnLiquidity,
      rateModel: jupDepositContext.rateModel,
      vault: jupDepositContext.vault,
      liquidity: jupDepositContext.liquidity,
      liquidityProgram: jupDepositContext.liquidityProgram,
      rewardsRateModel: jupDepositContext.rewardsRateModel
    })
    .signers([accounts.admin])
    .rpc({skipPreflight: true});

  console.log("Jup deposit transaction:", tx);
  
  return tx;
}