// Fixtures for Anchor visitors.
// Each pair: vulnerable + secure, framework: "anchor".

const ANCHOR_HEADER = `use anchor_lang::prelude::*;\n`;

// ---------- anchor-seeds-without-bump ----------
export const VULNERABLE_SEEDS_WITHOUT_BUMP = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Init<'info> {
  #[account(init, payer = admin, space = 8 + 32, seeds = [b"escrow"])]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

export const SECURE_SEEDS_WITH_BUMP = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Init<'info> {
  #[account(init, payer = admin, space = 8 + 32, seeds = [b"escrow"], bump)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

// ---------- anchor-init-without-space ----------
export const VULNERABLE_INIT_WITHOUT_SPACE = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Init<'info> {
  #[account(init, payer = admin)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

export const SECURE_INIT_WITH_SPACE = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Init<'info> {
  #[account(init, payer = admin, space = 8 + 32)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

export const SECURE_SPL_MINT_INIT_WITHOUT_SPACE = `${ANCHOR_HEADER}
use anchor_spl::token_interface::Mint;
#[derive(Accounts)]
pub struct Create<'info> {
  #[account(init, payer = payer, mint::decimals = 9, mint::authority = payer)]
  pub mint: InterfaceAccount<'info, Mint>,
  #[account(mut)]
  pub payer: Signer<'info>,
  pub system_program: Program<'info, System>,
}
`;

// ---------- anchor-init-without-payer ----------
export const VULNERABLE_INIT_WITHOUT_PAYER = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Init<'info> {
  #[account(init, space = 8 + 32)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

export const SECURE_INIT_WITH_PAYER = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Init<'info> {
  #[account(init, payer = admin, space = 8 + 32)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

export const VULNERABLE_NESTED_INIT_WITHOUT_PAYER = `${ANCHOR_HEADER}
pub mod accounts {
  use super::*;

  #[derive(Accounts)]
  pub struct Init<'info> {
    #[account(init, space = 8 + 32)]
    pub escrow: Account<'info, Escrow>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
  }
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

// ---------- anchor-realloc-incomplete ----------
export const VULNERABLE_REALLOC_INCOMPLETE = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Grow<'info> {
  #[account(mut, realloc = 8 + 64)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

export const SECURE_REALLOC_COMPLETE = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Grow<'info> {
  #[account(mut, realloc = 8 + 64, realloc::payer = admin, realloc::zero = true)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

// ---------- anchor-manual-signer-check ----------
export const VULNERABLE_MANUAL_SIGNER_CHECK = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Ctx<'info> {
  pub admin: AccountInfo<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn run(ctx: Context<Ctx>) -> Result<()> {
    if !ctx.accounts.admin.is_signer {
      return err!(ErrorCode::Unauthorized);
    }
    Ok(())
  }
}
#[error_code]
pub enum ErrorCode { Unauthorized }
`;

export const SECURE_TYPED_SIGNER = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Ctx<'info> {
  pub admin: Signer<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn run(_ctx: Context<Ctx>) -> Result<()> {
    Ok(())
  }
}
`;

// ---------- anchor-missing-mut ----------
export const VULNERABLE_MISSING_MUT = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Ctx<'info> {
  pub state: Account<'info, State>,
  pub admin: Signer<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn run(ctx: Context<Ctx>, new_value: u64) -> Result<()> {
    ctx.accounts.state.value = new_value;
    Ok(())
  }
}
#[account]
pub struct State { pub value: u64 }
`;

export const SECURE_MUT_CONSTRAINT = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Ctx<'info> {
  #[account(mut)]
  pub state: Account<'info, State>,
  pub admin: Signer<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn run(ctx: Context<Ctx>, new_value: u64) -> Result<()> {
    ctx.accounts.state.value = new_value;
    Ok(())
  }
}
#[account]
pub struct State { pub value: u64 }
`;

export const VULNERABLE_MISSING_MUT_DUPLICATE_FIELD = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Good<'info> {
  #[account(mut)]
  pub state: Account<'info, State>,
}
#[derive(Accounts)]
pub struct Bad<'info> {
  pub state: Account<'info, State>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn run(ctx: Context<Bad>, new_value: u64) -> Result<()> {
    ctx.accounts.state.value = new_value;
    Ok(())
  }
}
#[account]
pub struct State { pub value: u64 }
`;

export const VULNERABLE_MISSING_MUT_TO_ACCOUNT_INFO = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Ctx<'info> {
  pub state: Account<'info, State>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn run(ctx: Context<Ctx>) -> Result<()> {
    let mut data = ctx.accounts.state.to_account_info().try_borrow_mut_data()?;
    data[0] = 1;
    Ok(())
  }
}
#[account]
pub struct State { pub value: u64 }
`;

export const SECURE_LOCAL_FIELD_MUTATION = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Ctx<'info> {
  pub balance: Account<'info, State>,
}
pub struct Scratch { pub balance: u64 }
#[program]
pub mod my_program {
  use super::*;
  pub fn run(_ctx: Context<Ctx>, new_value: u64) -> Result<()> {
    let mut scratch = Scratch { balance: 0 };
    scratch.balance = new_value;
    Ok(())
  }
}
#[account]
pub struct State { pub value: u64 }
`;

// ---------- anchor-cpi-context-unverified ----------
export const VULNERABLE_CPI_UNVERIFIED = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Ctx<'info> {
  pub token_program: AccountInfo<'info>,
  pub admin: Signer<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn run(ctx: Context<Ctx>) -> Result<()> {
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), Empty {});
    invoke_helper(cpi_ctx)?;
    Ok(())
  }
}
struct Empty;
fn invoke_helper<T>(_c: CpiContext<T>) -> Result<()> { Ok(()) }
`;

export const VULNERABLE_CPI_UNVERIFIED_ALIAS = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Ctx<'info> {
  pub token_program: AccountInfo<'info>,
  pub admin: Signer<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn run(ctx: Context<Ctx>) -> Result<()> {
    let program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(program, Empty {});
    invoke_helper(cpi_ctx)?;
    Ok(())
  }
}
struct Empty;
fn invoke_helper<T>(_c: CpiContext<T>) -> Result<()> { Ok(()) }
`;

export const SECURE_CPI_TYPED_PROGRAM = `${ANCHOR_HEADER}
use anchor_spl::token::Token;
#[derive(Accounts)]
pub struct Ctx<'info> {
  pub token_program: Program<'info, Token>,
  pub admin: Signer<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn run(ctx: Context<Ctx>) -> Result<()> {
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), Empty {});
    invoke_helper(cpi_ctx)?;
    Ok(())
  }
}
struct Empty;
fn invoke_helper<T>(_c: CpiContext<T>) -> Result<()> { Ok(()) }
`;

export const VULNERABLE_CPI_UNVERIFIED_DUPLICATE_FIELD = `${ANCHOR_HEADER}
use anchor_spl::token::Token;
#[derive(Accounts)]
pub struct Good<'info> {
  pub token_program: Program<'info, Token>,
}
#[derive(Accounts)]
pub struct Bad<'info> {
  pub token_program: AccountInfo<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn run(ctx: Context<Bad>) -> Result<()> {
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), Empty {});
    invoke_helper(cpi_ctx)?;
    Ok(())
  }
}
struct Empty;
fn invoke_helper<T>(_c: CpiContext<T>) -> Result<()> { Ok(()) }
`;

// ---------- anchor-close-without-receiver ----------
export const VULNERABLE_CLOSE_MANUAL = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Ctx<'info> {
  #[account(mut)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub receiver: AccountInfo<'info>,
  pub admin: Signer<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn close_it(ctx: Context<Ctx>) -> Result<()> {
    let from = ctx.accounts.escrow.to_account_info();
    let dest = ctx.accounts.receiver.to_account_info();
    **dest.lamports.borrow_mut() = dest.lamports().checked_add(from.lamports()).unwrap();
    **ctx.accounts.escrow.to_account_info().lamports.borrow_mut() = 0;
    Ok(())
  }
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

export const VULNERABLE_CLOSE_MANUAL_DUPLICATE_FIELD = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Good<'info> {
  #[account(mut, close = receiver)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub receiver: AccountInfo<'info>,
}
#[derive(Accounts)]
pub struct Bad<'info> {
  #[account(mut)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub receiver: AccountInfo<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn close_it(ctx: Context<Bad>) -> Result<()> {
    **ctx.accounts.escrow.to_account_info().lamports.borrow_mut() = 0;
    Ok(())
  }
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

export const SECURE_CLOSE_CONSTRAINT = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Ctx<'info> {
  #[account(mut, close = receiver)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub receiver: AccountInfo<'info>,
  pub admin: Signer<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn close_it(_ctx: Context<Ctx>) -> Result<()> { Ok(()) }
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

// ---------- anchor-unchecked-account ----------
export const VULNERABLE_UNCHECKED_ACCOUNT = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Use<'info> {
  pub mystery: UncheckedAccount<'info>,
  pub admin: Signer<'info>,
}
`;

export const SECURE_TYPED_ACCOUNT = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Use<'info> {
  pub escrow: Account<'info, Escrow>,
  pub admin: Signer<'info>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;
