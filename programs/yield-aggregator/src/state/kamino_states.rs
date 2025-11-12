use anchor_lang::prelude::*;

#[account]
#[derive(Debug)]
pub struct ReserveLiquidity {
    pub mint_pubkey: Pubkey,
    pub supply_vault: Pubkey,
    pub fee_vault: Pubkey,
    pub available_amount: u64,
    pub borrowed_amount_sf: u128,
    pub market_price_sf: u128,
    pub market_price_last_updated_ts: u64,
    pub mint_decimals: u8,
}

#[account]
#[derive(Debug)]
pub struct ReserveCollateral {
    pub mint_pubkey: Pubkey,
    pub mint_total_supply: u64,
    pub supply_vault: Pubkey,
}

#[account]
#[derive(Debug)]
pub struct Reserve {
    pub version: u64,
    pub last_update: u64, // simplified
    pub lending_market: Pubkey,
    pub liquidity: ReserveLiquidity,
    pub collateral: ReserveCollateral,
    // other fields omitted for simplicity
}