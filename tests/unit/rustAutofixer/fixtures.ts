export const PINOCCHIO_HEADER = `use pinocchio::account_view::AccountView;
use pinocchio::program_error::ProgramError;
`;

export const VULNERABLE_MISSING_SIGNER = `${PINOCCHIO_HEADER}
pub struct InitAccounts<'a> {
  pub admin: &'a AccountView,
  pub escrow: &'a AccountView,
}

impl<'a> InitAccounts<'a> {
  pub fn try_from(accounts: &'a [AccountView]) -> Result<Self, ProgramError> {
    let [admin, escrow] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    Ok(Self { admin, escrow })
  }
}
`;

export const SECURE_MISSING_SIGNER = `${PINOCCHIO_HEADER}
pub struct InitAccounts<'a> {
  pub admin: &'a AccountView,
  pub escrow: &'a AccountView,
}

impl<'a> InitAccounts<'a> {
  pub fn try_from(accounts: &'a [AccountView]) -> Result<Self, ProgramError> {
    let [admin, escrow] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    verify_signer(admin, false)?;
    verify_owned_by(escrow, &crate::ID)?;
    Ok(Self { admin, escrow })
  }
}
`;

export const VULNERABLE_MISSING_OWNER = `use pinocchio::account_view::AccountView;
pub fn process(escrow: &AccountView) -> Result<(), ProgramError> {
  let escrow_state = Escrow::from_bytes(escrow.data())?;
  Ok(())
}
`;

export const SECURE_MISSING_OWNER = `use pinocchio::account_view::AccountView;
pub fn process(escrow: &AccountView) -> Result<(), ProgramError> {
  verify_current_program_account(escrow)?;
  validate_discriminator(escrow, Escrow::DISCRIMINATOR)?;
  let escrow_state = Escrow::from_bytes(escrow.data())?;
  Ok(())
}
`;

export const VULNERABLE_PROGRAM_ID = `use pinocchio::account_view::AccountView;
pub struct CreateAccounts<'a> {
  pub payer: &'a AccountView,
  pub system_program: &'a AccountView,
}
impl<'a> CreateAccounts<'a> {
  pub fn try_from(accounts: &'a [AccountView]) -> Result<Self, ProgramError> {
    let [payer, system_program] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    verify_signer(payer, false)?;
    Ok(Self { payer, system_program })
  }
}
`;

export const SECURE_PROGRAM_ID = `use pinocchio::account_view::AccountView;
pub struct CreateAccounts<'a> {
  pub payer: &'a AccountView,
  pub system_program: &'a AccountView,
}
impl<'a> CreateAccounts<'a> {
  pub fn try_from(accounts: &'a [AccountView]) -> Result<Self, ProgramError> {
    let [payer, system_program] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    verify_signer(payer, false)?;
    verify_system_program(system_program)?;
    Ok(Self { payer, system_program })
  }
}
`;

export const VULNERABLE_ARITHMETIC = `use pinocchio::program_error::ProgramError;
pub fn add_amounts(a: u64, b: u64) -> Result<u64, ProgramError> {
  Ok(a + b)
}
`;

export const SECURE_ARITHMETIC = `use pinocchio::program_error::ProgramError;
pub fn add_amounts(a: u64, b: u64) -> Result<u64, ProgramError> {
  a.checked_add(b).ok_or(ProgramError::ArithmeticOverflow)
}
`;

export const VULNERABLE_CPI = `use pinocchio::cpi::{invoke, Instruction};
pub fn forward(program: &AccountView, ix: &Instruction) -> Result<(), ProgramError> {
  invoke(ix, &[program.clone()])
}
`;

export const SECURE_CPI = `use pinocchio::cpi::{invoke, Instruction};
pub fn forward(token_program: &AccountView, ix: &Instruction) -> Result<(), ProgramError> {
  verify_token_program(token_program)?;
  invoke(ix, &[token_program.clone()])
}
`;

export const VULNERABLE_PDA = `use pinocchio::pubkey::find_program_address;
pub fn handle(account: &AccountView, seed: &[u8]) -> Result<(), ProgramError> {
  let (pda, _bump) = find_program_address(&[seed], &crate::ID);
  // never compared to account.key()
  Ok(())
}
`;

export const SECURE_PDA = `use pinocchio::pubkey::find_program_address;
pub fn handle(account: &AccountView, seed: &[u8]) -> Result<(), ProgramError> {
  let (pda, _bump) = find_program_address(&[seed], &crate::ID);
  assert_eq!(&pda, account.key());
  Ok(())
}
`;

export const VULNERABLE_SYSVAR = `use pinocchio::account_view::AccountView;
pub struct Withdraw<'a> { pub rent_sysvar: &'a AccountView }
impl<'a> Withdraw<'a> {
  pub fn try_from(accounts: &'a [AccountView]) -> Result<Self, ProgramError> {
    let [rent_sysvar] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    Ok(Self { rent_sysvar })
  }
}
`;

export const SECURE_SYSVAR = `use pinocchio::account_view::AccountView;
pub struct Withdraw<'a> { pub rent_sysvar: &'a AccountView }
impl<'a> Withdraw<'a> {
  pub fn try_from(accounts: &'a [AccountView]) -> Result<Self, ProgramError> {
    let [rent_sysvar] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    verify_sysvar(rent_sysvar, &Rent::id())?;
    Ok(Self { rent_sysvar })
  }
}
`;

// ---------- regression fixtures: real-world patterns lifted from SF code ----------

// solana-attestation-service/program/src/processor/create_credential.rs:43
// PDA validated via `.ne()` method, not `==` / `!=`. Must NOT fire pda-validation.
export const SECURE_PDA_NE_METHOD = `use pinocchio::pubkey::find_program_address;
pub fn handle(credential_info: &AccountView, name: &[u8], authority: &AccountView) -> Result<(), ProgramError> {
  let (credential_pda, _bump) = find_program_address(&[b"credential", authority.key(), name], &crate::ID);
  if credential_info.key().ne(&credential_pda.to_bytes()) {
    return Err(ProgramError::InvalidArgument);
  }
  Ok(())
}
`;

// PDA validated via assert_ne! macro. Must NOT fire pda-validation.
export const SECURE_PDA_ASSERT_NE = `use pinocchio::pubkey::find_program_address;
pub fn handle(account: &AccountView, seed: &[u8]) -> Result<(), ProgramError> {
  let (pda, _bump) = find_program_address(&[seed], &crate::ID);
  assert_ne!(account.key(), &pda.to_bytes(), "wrong pda");
  Ok(())
}
`;

// Account-layout / size math using len(). No balance-shaped identifiers.
// Must NOT fire unchecked-arithmetic.
export const SECURE_ARITHMETIC_LEN_MATH = `pub fn space_for(signers: &[u8], name: &str) -> usize {
  1 + (4 + signers.len() * 32) + 32 + (4 + name.len())
}
`;

// Real balance math — bare add, no checked_*. Must fire unchecked-arithmetic.
export const VULNERABLE_ARITHMETIC_LAMPORTS = `pub fn update(state: &mut State, delta: u64) {
  state.lamports = state.lamports + delta;
}
`;
