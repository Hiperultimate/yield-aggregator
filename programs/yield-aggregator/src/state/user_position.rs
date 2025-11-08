use anchor_lang::prelude::*;

// User specific
#[account]
#[derive(InitSpace)]
pub struct UserPosition {
    /// The vault this user belongs to
    pub vault: Pubkey,

    /// The user’s wallet address
    pub user: Pubkey,

    /// The number of vault shares this user owns.
    ///
    /// Each "share" represents a proportional ownership of the vault’s total USDC value.
    /// For example:
    /// - If the vault has 10,000 USDC and total_shares = 10,000, then 1 share = 1 USDC.
    /// - If yield increases vault value to 12,000 USDC but total_shares stays 10,000,
    ///   then each share is now worth 1.2 USDC.
    ///
    /// This field is used to determine how much a user gets back on withdrawal.
    pub shares: u64,

    /// The user’s yield checkpoint, equal to (shares * acc_per_share)
    /// at the time of their last deposit or withdrawal.
    ///
    /// This ensures the user only earns yield generated *after* they joined.
    pub reward_debt: u128,

    /// Rewards accumulated but not yet withdrawn.
    /// When the user deposits again, their pending rewards are added here first.
    pub pending_rewards: u64,

    pub last_updated: i64,

    pub bump: u8,
}
