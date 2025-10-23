use anchor_lang::prelude::*;

// Global vault
#[account]
#[derive(InitSpace)]
pub struct Vault {
    /// The admin authority that can configure or rebalance this vault
    pub authority: Pubkey,

    /// The USDC mint accepted by this vault
    pub usdc_mint: Pubkey,

    /// Vault's USDC ATA
    pub vault_usdc_ata: Pubkey,

    /// Allocation config (target ratios)
    pub allocation_config: Pubkey,

    pub total_deposits: u64,

    pub total_yield: u64,

    /// USDC currently deployed in JupLend Earn
    pub jup_lend_balance: u64,

    /// USDC currently deployed in Kamino Earn
    pub kamino_balance: u64,

    // TODO : Will give the functionality to pause trades where we will take out the allocations are hold inside the account
    /// Active or paused state 
    pub is_active: bool,

    pub bump: u8,
}
