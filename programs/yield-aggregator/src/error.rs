use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid allocation ratio provided.")]
    InvalidAllocation,

    #[msg("CPI_TO_LENDING_PROGRAM_FAILED")]
    CpiToLendingProgramFailed,
}
