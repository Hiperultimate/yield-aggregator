use anchor_lang::prelude::*;

// User specific
#[account]
#[derive(InitSpace)]
pub struct UserPosition {
    /// The vault this position belongs to
    pub vault: Pubkey,

    /// The user’s wallet address
    pub user: Pubkey,

    /// Amount of USDC the user deposited
    pub deposited_amount: u64,

    /// Accrued yield (claimable)
    pub earned_yield: u64,

    /// When the user last interacted with the vault
    pub last_updated: i64,

    /// Bump for the PDA
    pub bump: u8,
}
