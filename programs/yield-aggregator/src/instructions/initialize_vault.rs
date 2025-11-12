use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_interface::{Mint, TokenAccount, TokenInterface}};

use crate::Vault;

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub admin : Signer<'info>,

    #[account(
        mint::token_program=token_program
    )]
    pub usdc_mint : InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer=admin,
        associated_token::mint=usdc_mint,
        associated_token::authority=vault,
        associated_token::token_program=token_program
    )]
    pub vault_usdc_ata : InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = admin,
        space = 8 + Vault::INIT_SPACE,
        seeds = [b"vault", admin.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,   // Global vault

    // Jup f_token_account init
    #[account(
        init,
        payer = admin,
        associated_token::mint = jup_f_token_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program
    )]
    pub vault_f_token_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mint::token_program=token_program
    )]
    pub jup_f_token_mint : InterfaceAccount<'info, Mint>,

    #[account(
        mint::token_program=token_program
    )]
    pub kamino_collateral_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        associated_token::mint= kamino_collateral_mint,
        associated_token::authority= vault,
        associated_token::token_program=token_program,
    )]
    pub vault_kamino_token_ata: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>

}

impl<'info> InitializeVault<'info> {
    pub fn initialize_vault(&mut self, vault_bump: u8) -> Result<()>{
        let current_time = Clock::get().unwrap().unix_timestamp;

        // vault states
        self.vault.authority = self.admin.key();
        self.vault.usdc_mint = self.usdc_mint.key();
        self.vault.vault_usdc_ata = self.vault_usdc_ata.key();
        self.vault.total_shares = 0;
        self.vault.acc_per_share = 0;
        self.vault.total_underlying = 0;
        self.vault.jup_lend_balance = 0;
        self.vault.kamino_balance = 0;
        self.vault.last_jup_value = 0;
        self.vault.last_kamino_value = 0;
        self.vault.jup_allocation = 5000; // 50 %
        self.vault.kamino_allocation = 5000; // 50 %
        self.vault.last_update_ts = current_time;
        self.vault.bump = vault_bump;
        Ok(())
    }
}

pub fn handler(ctx: Context<InitializeVault>)  -> Result<()> {
    ctx.accounts.initialize_vault(ctx.bumps.vault)?;
    Ok(())
}
