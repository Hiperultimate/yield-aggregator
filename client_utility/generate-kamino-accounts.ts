import { getAssociatedTokenAddress } from '@solana/spl-token';
import { lendingMarketAuthPda, reserveCollateralMintPda, reserveCollateralSupplyPda, reserveLiqSupplyPda } from '@kamino-finance/klend-sdk';
import * as anchor from "@coral-xyz/anchor";

import {
  createDefaultRpcTransport,
  createRpc,
  createSolanaRpcApi,
  DEFAULT_RPC_CONFIG,
  Rpc,
  Address,
  SolanaRpcApi,
} from '@solana/kit';

const TOKEN_PROGRAM_ID = new anchor.web3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSVAR_INSTRUCTIONS = new anchor.web3.PublicKey('Sysvar1nstructions1111111111111111111111111');

export async function getDepositReserveLiquidityAccounts(
  owner: anchor.web3.PublicKey,
  reserve: Address,
  lendingMarket: Address,
  liquidityMint: Address
// ): Promise<DepositReserveLiquidityAccounts> {
) {
  const [lendingMarketAuthority] = await lendingMarketAuthPda(lendingMarket);
  const [reserveLiquiditySupply] = await reserveLiqSupplyPda(lendingMarket, liquidityMint);
  const [reserveCollateralMint] = await reserveCollateralMintPda(lendingMarket, liquidityMint);
  const [reserveCollateralSupply] = await reserveCollateralSupplyPda(lendingMarket, liquidityMint);
  const userSourceLiquidity = await getAssociatedTokenAddress(new anchor.web3.PublicKey(liquidityMint), owner);
  const userDestinationCollateral = await getAssociatedTokenAddress(new anchor.web3.PublicKey(reserveCollateralMint), owner);
  return {
    owner,
    reserve: new anchor.web3.PublicKey(reserve),
    lendingMarket: new anchor.web3.PublicKey(lendingMarket),
    lendingMarketAuthority: new anchor.web3.PublicKey(lendingMarketAuthority),
    reserveLiquidityMint: new anchor.web3.PublicKey(liquidityMint),
    reserveLiquiditySupply: new anchor.web3.PublicKey(reserveLiquiditySupply),
    reserveCollateralMint: new anchor.web3.PublicKey(reserveCollateralMint),
    userSourceLiquidity,
    userDestinationCollateral,
    collateralTokenProgram: TOKEN_PROGRAM_ID,
    liquidityTokenProgram: TOKEN_PROGRAM_ID,
    instructionSysvarAccount: SYSVAR_INSTRUCTIONS,
  };
}


export function initRpc(rpcUrl: string): Rpc<SolanaRpcApi> {
  const api = createSolanaRpcApi<SolanaRpcApi>({
    ...DEFAULT_RPC_CONFIG,
    defaultCommitment: 'processed',
  });
  return createRpc({ api, transport: createDefaultRpcTransport({ url: rpcUrl }) });
}
// const rpc = initRpc('https://api.mainnet-beta.solana.com');
// const market = await KaminoMarket.load(rpc, lendingMarket);