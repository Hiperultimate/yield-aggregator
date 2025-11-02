use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction},
    program::invoke,
};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::Token;
// use crate::jup_cpi;
// use crate::jup_accounts;
// use crate::JupLendingProgram;

#[error_code]
pub enum ErrorCodes {
    #[msg("CPI_TO_LENDING_PROGRAM_FAILED")]
    CpiToLendingProgramFailed,
}

fn get_deposit_discriminator() -> Vec<u8> {
    // discriminator = sha256("global:deposit")[0..8]
    vec![242, 35, 198, 137, 82, 225, 242, 182]  // mainnet instruction
}

#[derive(Accounts)]
pub struct DepositJup<'info> {
    /// signer (mutable, signer = true)
    #[account(mut)]
    pub signer: Signer<'info>,

    /// depositor_token_account (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub depositor_token_account: AccountInfo<'info>,

    /// recipient_token_account (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub recipient_token_account: AccountInfo<'info>,

    /// mint (read-only)
    /// /// CHECK: Validated by lending program
    pub mint: AccountInfo<'info>,

    /// lending_admin (read-only)
    /// /// CHECK: Validated by lending program
    pub lending_admin: AccountInfo<'info>,

    /// lending (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub lending: AccountInfo<'info>,

    /// f_token_mint (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub f_token_mint: AccountInfo<'info>,

    /// supply_token_reserves_liquidity (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub supply_token_reserves_liquidity: AccountInfo<'info>,

    /// lending_supply_position_on_liquidity (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub lending_supply_position_on_liquidity: AccountInfo<'info>,

    /// rate_model (read-only)
    /// /// CHECK: Validated by lending program
    pub rate_model: AccountInfo<'info>,

    /// vault (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub vault: AccountInfo<'info>,

    /// liquidity (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub liquidity: AccountInfo<'info>,

    /// liquidity_program (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub liquidity_program: AccountInfo<'info>,

    /// rewards_rate_model (read-only)
    /// /// CHECK: Validated by lending program
    pub rewards_rate_model: AccountInfo<'info>,

    /// CHECK: Validated by lending program
    pub lending_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}


impl<'info> DepositJup<'info> {
    pub fn deposit(&self, amount: u64) -> Result<()> {
        let mut instruction_data = get_deposit_discriminator();
        instruction_data.extend_from_slice(&amount.to_le_bytes());

        let account_metas = vec![
            // signer (mutable, signer)
            AccountMeta::new(*self.signer.key, true),
            // depositor_token_account (mutable)
            AccountMeta::new(*self.depositor_token_account.key, false),
            // recipient_token_account (mutable)
            AccountMeta::new(*self.recipient_token_account.key, false),
            // mint
            AccountMeta::new_readonly(*self.mint.key, false),
            // lending_admin (readonly)
            AccountMeta::new_readonly(*self.lending_admin.key, false),
            // lending (mutable)
            AccountMeta::new(*self.lending.key, false),
            // f_token_mint (mutable)
            AccountMeta::new(*self.f_token_mint.key, false),
            // supply_token_reserves_liquidity (mutable)
            AccountMeta::new(*self.supply_token_reserves_liquidity.key, false),
            // lending_supply_position_on_liquidity (mutable)
            AccountMeta::new(*self.lending_supply_position_on_liquidity.key, false),
            // rate_model (readonly)
            AccountMeta::new_readonly(*self.rate_model.key, false),
            // vault (mutable)
            AccountMeta::new(*self.vault.key, false),
            // liquidity (mutable)
            AccountMeta::new(*self.liquidity.key, false),
            // liquidity_program (mutable)
            AccountMeta::new(*self.liquidity_program.key, false),
            // rewards_rate_model (readonly)
            AccountMeta::new_readonly(*self.rewards_rate_model.key, false),
            // token_program
            AccountMeta::new_readonly(*self.token_program.key, false),
            // associated_token_program
            AccountMeta::new_readonly(*self.associated_token_program.key, false),
            // system_program
            AccountMeta::new_readonly(*self.system_program.key, false),
        ];

        msg!("Checking lending program {:?}", self.lending_program.key());
        // msg!("Instruction data {:?}", self.instruction_data);

        let instruction = Instruction {
            program_id: *self.lending_program.key,
            accounts: account_metas,
            data: instruction_data,
        };

        invoke(
            &instruction,
            &[
                self.signer.to_account_info(),
                self.depositor_token_account.clone(),
                self.recipient_token_account.clone(),
                self.mint.clone(),
                self.lending_admin.clone(),
                self.lending.clone(),
                self.f_token_mint.clone(),
                self.supply_token_reserves_liquidity.clone(),
                self.lending_supply_position_on_liquidity.clone(),
                self.rate_model.clone(),
                self.vault.clone(),
                self.liquidity.clone(),
                self.liquidity_program.clone(),
                self.rewards_rate_model.clone(),
                self.token_program.to_account_info(),
                self.associated_token_program.to_account_info(),
                self.system_program.to_account_info(),
            ],
        )
        .map_err(|_| ErrorCodes::CpiToLendingProgramFailed.into())
        // Ok(())
    }
}

pub fn handler(ctx : Context<DepositJup> , amount : u64) -> Result<()>{
    msg!("Reaching here .......");
    ctx.accounts.deposit(amount)
    // Ok(())
}