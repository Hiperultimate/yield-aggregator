import * as anchor from "@coral-xyz/anchor";
import { YieldAggregator } from "../../target/types/yield_aggregator";

export async function jupWithdraw(
  program: anchor.Program<YieldAggregator>,
  provider: anchor.AnchorProvider,
  withdrawAmount: anchor.BN,
  accounts: {
    admin: anchor.web3.Keypair;
    usdcMint: anchor.web3.PublicKey;
  }
) {
  const { getWithdrawContext } = await import("@jup-ag/lend/earn");

  const jupWithdrawContext = await getWithdrawContext({
    asset: accounts.usdcMint,
    connection: provider.connection,
    signer: accounts.admin.publicKey,
  });

  const tx = await program.methods
    .jupWithdraw(withdrawAmount)
    .accounts({
      admin: accounts.admin.publicKey,
      usdcMint: accounts.usdcMint,
      fTokenMint: jupWithdrawContext.fTokenMint,
      lendingAdmin: jupWithdrawContext.lendingAdmin,
      lending: jupWithdrawContext.lending,
      supplyTokenReservesLiquidity:
        jupWithdrawContext.supplyTokenReservesLiquidity,
      lendingSupplyPositionOnLiquidity:
        jupWithdrawContext.lendingSupplyPositionOnLiquidity,
      rateModel: jupWithdrawContext.rateModel,
      claimAccount: jupWithdrawContext.claimAccount,
      vault: jupWithdrawContext.vault,
      liquidity: jupWithdrawContext.liquidity,
      liquidityProgram: jupWithdrawContext.liquidityProgram,
      rewardsRateModel: jupWithdrawContext.rewardsRateModel,
    })
    .signers([accounts.admin])
    .rpc({ skipPreflight: true });

  console.log("Jup withdraw transaction:", tx);

  return tx;
}
