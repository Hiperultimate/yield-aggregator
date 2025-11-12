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

    /// Total shares issued across all users.
    /// Each user's share represents how much of the vault's total underlying they own.
    /// 1 share ~= 1 USDC initially, but as yield accrues, 1 share > 1 USDC.
    pub total_shares: u64,

    /// Global accumulated yield per share (scaled by SCALER for precision).
    /// Used to calculate user yield since their last update.
    pub acc_per_share: u64,

    /// Total underlying USDC-equivalent value of this vault.
    /// Includes allocations in JupLend, Kamino, and unallocated USDC sitting in the vault.
    pub total_underlying: u64,

    
    // Allocation Config
    /// Amount of USDC currently deposited in JupLend
    pub jup_lend_balance: u64,

    /// Amount of USDC currently deposited in KaminoLend
    pub kamino_balance: u64,

    /// Last recorded value (snapshot) of JupLend allocation.
    /// Used to measure performance (gain/loss) since last update.
    /// Values stored in terms of USDC
    pub last_jup_value: u64,

    /// Last recorded value (snapshot) of KaminoLend allocation.
    /// Used to measure performance (gain/loss) since last update.
    /// Values stored in terms of USDC
    pub last_kamino_value: u64,

    /// Target allocation percentage 
    pub jup_allocation: u16,    // e.g , 6000 = 60% -> For precision 61.34% = 6134
    pub kamino_allocation: u16, // e.g , 4000 = 40%

    /// Timestamp of the last yield update or rebalance action
    pub last_update_ts: i64,

    pub bump: u8,
}
