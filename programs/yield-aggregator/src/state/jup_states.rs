use anchor_lang::prelude::*;

#[account]
#[derive(Debug)]
pub struct Lending {
    pub mint: Pubkey,                         // usdc mint address
    pub f_token_mint: Pubkey,                 // f-token mint address
    pub lending_id: u16,                      // Unique ID for the lending market
    pub decimals: u8,                         // Number of decimals
    pub rewards_rate_model: Pubkey,           // PDA of the rewards rate model
    pub liquidity_exchange_price: u64,        // Exchange price without rewards
    pub token_exchange_price: u64,            // Exchange price with rewards (f-token to usdc)
    pub last_update_timestamp: u64,           // Last time prices were updated
    pub token_reserves_liquidity: Pubkey,     // Liquidity reserves account
    pub supply_position_on_liquidity: Pubkey, // Supply position account
    pub bump: u8,                             // PDA bump seed
}
