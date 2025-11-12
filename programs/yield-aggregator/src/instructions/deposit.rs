use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_interface::{Mint, TokenAccount, TokenInterface, TransferChecked, transfer_checked}};

use crate::{UserPosition, Vault};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        constraint = vault.usdc_mint == usdc_mint.key()
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserPosition::INIT_SPACE,
        seeds = [b"user_position", user.key().as_ref()],
        bump
    )]
    pub user_position: Account<'info, UserPosition>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    // init_if_needed not required because user is transferring USDC so it should already be there
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program
    )]
    pub user_usdc_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program
    )]
    pub vault_usdc_ata: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> Deposit<'info> {
    pub fn update_states(&mut self, amount: u64, bump: u8) -> Result<()> {
        let current_time = Clock::get().unwrap().unix_timestamp;
        let existed = self.user_position.shares > 0;

        if !existed {
            // Initialize user position if needed
            self.user_position.user = self.user.key();
            self.user_position.vault = self.vault.key();
            self.user_position.shares = amount;
            self.user_position.reward_debt = (amount as u128) * (self.vault.acc_per_share as u128);
            self.user_position.pending_rewards = 0;
            self.user_position.last_updated = current_time;
            self.user_position.bump = bump;
        } else {
            // Getting pending rewards that the user has
            let pending = (self.user_position.shares as u128)
                .checked_mul(self.vault.acc_per_share as u128)
                .unwrap()
                .saturating_sub(self.user_position.reward_debt);
            self.user_position.pending_rewards = self.user_position.pending_rewards.checked_add(pending as u64).unwrap();

            // Update shares & reward checkpoint
            self.user_position.shares = self.user_position.shares.checked_add(amount).unwrap();
            self.user_position.reward_debt = (self.user_position.shares as u128)
                .checked_mul(self.vault.acc_per_share as u128)
                .unwrap();
        }

        self.vault.total_underlying += amount;
        self.vault.total_shares += amount;
        self.user_position.last_updated = current_time;

        Ok(())
    }

    pub fn desposit_to_vault_ata(&mut self, deposited_amount : u64) -> Result<()>{
        // deposit usdc to main_vault_usdc_ata from user account
        let accounts = TransferChecked { 
            authority: self.user.to_account_info(),
            from: self.user_usdc_ata.to_account_info(),
            to: self.vault_usdc_ata.to_account_info(),
            mint: self.usdc_mint.to_account_info(),
        };
        let cpi_context = CpiContext::new(self.token_program.to_account_info(), accounts);

        transfer_checked(cpi_context, deposited_amount, self.usdc_mint.decimals)
    }
}

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    ctx.accounts.update_states(amount, ctx.bumps.user_position)?;
    ctx.accounts.desposit_to_vault_ata(amount)?;
    Ok(())
}