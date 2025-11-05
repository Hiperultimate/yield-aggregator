    use anchor_lang::prelude::*;
use std::ops::{Div, Mul};
use anchor_lang::solana_program::{
    account_info::AccountInfo
};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Token, TransferChecked, transfer_checked};
use anchor_spl::token_interface::{Mint, TokenAccount};
use crate::error::ErrorCode;
use crate::{AllocationConfig, AllocationMode, Lending as JupLending, UserPosition, Vault, jup_cpi};
use crate::jup_accounts;
use crate::JupLendingProgram;


#[derive(Accounts)]
pub struct Deposit<'info> {
    /// signer (mutable, signer = true)
    #[account(mut)]
    pub user: Signer<'info>, // user

    /// CHECK: admin details required to derive vault
    #[account(
        constraint = main_vault.authority.key() == admin.key()
    )]
    pub admin : AccountInfo<'info>,

    /// mint (read-only)
    #[account(
        constraint = main_vault.usdc_mint.key() == usdc_mint.key(), 
        mint::token_program=token_program
    )]
    pub usdc_mint : InterfaceAccount<'info, Mint>,   // USDC Mint

    #[account(
        mut,
        // constraint = main_vault.vault_usdc_ata.key() == main_vault_usdc_ata.key(), // We add this later
        associated_token::mint=usdc_mint,
        associated_token::authority=user,
        associated_token::token_program=token_program
    )]
    pub user_usdc_ata : InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", admin.key().as_ref()],
        bump
    )]
    pub main_vault: Box<Account<'info, Vault>>,   // Global vault | Use this account to make the deposit

    #[account(
        // add a constriant to confirm which admin yield instruction it belongs it
        seeds=[b"allocation_config", admin.key().as_ref() ],
        bump
    )]
    pub vault_allocation_config : Box<Account<'info, AllocationConfig>>,

    #[account(
        mut,
        constraint = main_vault.vault_usdc_ata.key() == main_vault_usdc_ata.key(),
        associated_token::mint=usdc_mint,
        associated_token::authority=main_vault,
        associated_token::token_program=token_program
    )]
    pub main_vault_usdc_ata : InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer=user,
        seeds = [b"user_position", user.key().as_ref()],
        space=8+UserPosition::INIT_SPACE,
        bump
    )]
    pub user_position : Box<Account<'info, UserPosition>>,

    #[account(
        mut,
        // constraint = main_vault.vault_usdc_ata.key() == main_vault_usdc_ata.key(), // We add this later
        associated_token::mint=f_token_mint,
        associated_token::authority=main_vault,
        associated_token::token_program=token_program
    )]
    pub main_vault_f_token_ata : InterfaceAccount<'info, TokenAccount>,

    /// f_token_mint (mutable)
    #[account(
        mut,
        mint::token_program=token_program
    )]
    pub f_token_mint : InterfaceAccount<'info, Mint>,


    /// lending_admin (read-only)
    /// CHECK: Validated by lending program
    pub lending_admin: AccountInfo<'info>,

    /// lending (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub lending: AccountInfo<'info>,
    
    /// supply_token_reserves_liquidity (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub supply_token_reserves_liquidity: AccountInfo<'info>,
    
    /// lending_supply_position_on_liquidity (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub lending_supply_position_on_liquidity: AccountInfo<'info>,
    
    /// rate_model (read-only)
    /// CHECK: Validated by lending program
    pub rate_model: AccountInfo<'info>,
    
    /// vault (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub vault: AccountInfo<'info>,
    
    /// depositor_token_account (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub depositor_token_account: AccountInfo<'info>,

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
    pub lending_program: Program<'info, JupLendingProgram>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}


impl<'info> Deposit<'info> {
    pub fn update_user_position(&mut self, deposited_amount : u64, user_position_bump: u8) -> Result<()>{
        let current_time = Clock::get().unwrap().unix_timestamp;

        let existed = self.user_position.deposited_amount > 0;

        if !existed {
            // User is new, create user_position
            self.user_position.vault = self.main_vault.key();
            self.user_position.user = self.user.key();
            self.user_position.deposited_amount = deposited_amount;
            self.user_position.earned_yield = 0;
            self.user_position.last_updated = current_time;
            self.user_position.bump = user_position_bump;

        } else {
            // Existing user, update existing user_position
            msg!("Current user position amount : {}", self.user_position.deposited_amount);
            msg!("New user position amount : {}", self.user_position.deposited_amount + deposited_amount);

            self.user_position.deposited_amount += deposited_amount;
            self.user_position.last_updated = current_time;
        }

        Ok(())
    }

    pub fn update_vault_state(&mut self, total_deposited_amount : u64, jup_deposited_amount : u64, kamino_deposited_amount: u64) -> Result<()>{
        self.main_vault.total_deposits += total_deposited_amount;
        self.main_vault.jup_lend_balance += jup_deposited_amount;
        self.main_vault.kamino_balance += kamino_deposited_amount;
        Ok(())
    }

    pub fn desposit_to_vault_ata(&mut self, deposited_amount : u64) -> Result<()>{
        // deposit usdc to main_vault_usdc_ata from user account
        let accounts = TransferChecked { 
            authority: self.user.to_account_info(),
            from: self.user_usdc_ata.to_account_info(),
            to: self.main_vault_usdc_ata.to_account_info(),
            mint: self.usdc_mint.to_account_info(),
        };
        let cpi_context = CpiContext::new(self.token_program.to_account_info(), accounts);

        transfer_checked(cpi_context, deposited_amount, self.usdc_mint.decimals)
    }

    pub fn jup_deposit(&mut self, deposited_amount : u64) -> Result<()> {
        // transfer to jup
        let jup_accounts = jup_accounts::Deposit{
            signer: self.main_vault.to_account_info() ,
            depositor_token_account : self.main_vault_usdc_ata.to_account_info(),
            recipient_token_account: self.main_vault_f_token_ata.to_account_info(),

            associated_token_program : self.associated_token_program.to_account_info(),
            f_token_mint: self.f_token_mint.to_account_info(),
            lending: self.lending.to_account_info(),
            lending_admin: self.lending_admin.to_account_info() ,
            lending_supply_position_on_liquidity: self.lending_supply_position_on_liquidity.to_account_info() ,
            liquidity: self.liquidity.to_account_info() , 
            liquidity_program: self.liquidity_program.to_account_info() ,
            mint: self.usdc_mint.to_account_info() , 
            rate_model: self.rate_model.to_account_info() ,
            rewards_rate_model: self.rewards_rate_model.to_account_info() ,
            supply_token_reserves_liquidity: self.supply_token_reserves_liquidity.to_account_info() ,
            system_program: self.system_program.to_account_info() ,
            token_program: self.token_program.to_account_info() ,
            vault: self.vault.to_account_info() , 
        };

        let admin_key = self.admin.key();
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", admin_key.as_ref(),&[self.main_vault.bump]]];

        let jup_cpi_program = self.lending_program.to_account_info();
        let jup_cpi_context = CpiContext::new_with_signer(jup_cpi_program, jup_accounts, signer_seeds);
        match jup_cpi::deposit(jup_cpi_context, deposited_amount){
            Ok(_) => Ok(()),
            Err(_) => Err(ErrorCode::CpiToLendingProgramFailed.into())
        }
    }

    // TODO : create allocate_funds function which checks allocation_config and spreads the deposited_amount accordingly
    pub fn allocate_funds(&mut self, deposited_amount : u64) -> Result<()>{
        // Check the mode
        let config_mode = self.vault_allocation_config.mode.clone();

        // fetch current price of the spent USDC

        // Current price held in jup
        let vault_f_token_balance = self.main_vault_f_token_ata.amount;
        let lending_data = JupLending::try_deserialize(&mut &self.lending.data.borrow()[..])?;
        let token_exchange_price = lending_data.token_exchange_price;   // price of 1 F-token in terms of USDC, if you need usdc val then / 10 ** 12
        let jup_usdc_scaled : u128 = (vault_f_token_balance as u128)
                                        .checked_mul(token_exchange_price as u128)
                                        .and_then(|v| v.checked_div(10_u128.pow(12 ))) // div by 10**12 because of token_exchange_price
                                        .unwrap();
        let jup_usdc_value : u64 = jup_usdc_scaled.try_into().unwrap(); // f-token non-decimal version, 10**6

        // Current price held in kamino
        let kamino_usdc_value: u64 = 0;  // dummy value for now

        match config_mode {
            AllocationMode::Static => {
                // manual balancing

                // calculate the spread, how much amount needs to go in Jup and kamino
                // but allocation can change overtime, so users money will not be spread evenly
                let a_j = jup_usdc_value; // current price in Jup
                let a_k = kamino_usdc_value; // current price in Kamino
                let t = a_j + a_k;  // total price invested

                let r_j = self.vault_allocation_config.jup_allocation as u128; // jup ratio percent, i.e. contains values like 4722, 47.22% = 4722
                let r_k = self.vault_allocation_config.kamino_allocation as u128; // kamino ratio
                let d = deposited_amount;   // new deposit amount

                let t_n = (t + d) as u128;    // new total
                let a_nj = r_j.checked_mul(t_n).and_then(|v| v.checked_div(10_000)).unwrap() as u64;    // total jup amount     div by 10_000 because 4722 percent conversion = 47.22 % / 100 = 0.4722 / 10_000
                let a_nk = r_k.checked_mul(t_n).and_then(|v| v.checked_div(10_000)).unwrap() as u64;    // total kamino amount
                let mut addj = a_nj - a_j;  // jup amount to add
                let mut addk = a_nk - a_k;  // kamino amount to add

                // Handle impossible / out of bound scenarios
                if addj < 0 {
                    addj = 0;
                    addk = d;
                }
                // Kamino is overweight, cannot withraw -> deposit everything in Jup
                else if addk < 0 {
                    addj = d;
                    addk = 0;
                }
                else {
                    // both positive - normal case
                    // normalizing if addj + addk > d
                    if addj + addk > d {
                        // normalize proportionally
                        let scale = d.div(addj + addk);
                        addj = addj * scale;
                        addk = addk * scale;
                    }
                }

                // Write logic to transfer addj to jup
                if addj > 0 {
                    self.jup_deposit(addj)?;
                }

                if(addk > 0){
                    // Call kamino deposit function here
                }
                
                // Write logic to transfer addk to kamino

                // Update main_vault states
                self.update_vault_state(deposited_amount, addj, addk)?;
        
            },
            AllocationMode::Dynamic => {
                // auto balancing

                // Update vault states using self.update_vault_state function
            }
        }

        
        Ok(())
    }

}

pub fn handler(ctx : Context<Deposit> , amount : u64) -> Result<()>{
    msg!("Reaching here .......");
    ctx.accounts.update_user_position(amount, ctx.bumps.user_position)?;
    ctx.accounts.desposit_to_vault_ata(amount)?;
    ctx.accounts.allocate_funds(amount)?;
    Ok(())
}