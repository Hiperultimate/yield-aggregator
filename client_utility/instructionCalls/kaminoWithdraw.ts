import * as anchor from "@coral-xyz/anchor";
import {
  getDepositReserveLiquidityAccounts,
  initRpc,
} from "../generate-kamino-accounts";
import {
  DEFAULT_RECENT_SLOT_DURATION_MS,
  KaminoMarket,
} from "@kamino-finance/klend-sdk";
import { YieldAggregator } from "../../target/types/yield_aggregator";
import { Address } from "@solana/kit";

const KLEND_PROGRAM_ID = new anchor.web3.PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
) as any;

export async function kaminoWithdraw(
  program: anchor.Program<YieldAggregator>,
  withdrawAmount: anchor.BN,
  accounts: {
    admin: anchor.web3.Keypair;
    usdcMint: anchor.web3.PublicKey;
  }
) {
  const kaminoMainMarket = new anchor.web3.PublicKey(
    "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"
  );
  const rpc = initRpc("http://localhost:8899");
  const market = await KaminoMarket.load(
    rpc as any,
    kaminoMainMarket.toBase58() as Address,
    DEFAULT_RECENT_SLOT_DURATION_MS
  );
  const reserve = market.getReserveByMint(
    accounts.usdcMint.toBase58() as Address
  );
  const ixAccounts = await getDepositReserveLiquidityAccounts(
    accounts.admin.publicKey,
    reserve.address,
    kaminoMainMarket.toBase58() as Address,
    accounts.usdcMint.toBase58() as Address
  );

  const tx = await program.methods
    .kaminoWithdraw(withdrawAmount)
    .accounts({
      admin: accounts.admin.publicKey,
      usdcMint: accounts.usdcMint,
      reserve: ixAccounts.reserve,
      lendingMarket: ixAccounts.lendingMarket,
      lendingMarketAuthority: ixAccounts.lendingMarketAuthority,
      reserveLiquiditySupply: ixAccounts.reserveLiquiditySupply,
      reserveCollateralMint: ixAccounts.reserveCollateralMint,
      collateralTokenProgram: ixAccounts.collateralTokenProgram,
      liquidityTokenProgram: ixAccounts.liquidityTokenProgram,
      instructionSysvarAccount: ixAccounts.instructionSysvarAccount,
      klendProgram: KLEND_PROGRAM_ID,
    })
    .signers([accounts.admin])
    .rpc({ skipPreflight: true });

  console.log("Kamino withdraw transaction:", tx);

  return tx;
}
