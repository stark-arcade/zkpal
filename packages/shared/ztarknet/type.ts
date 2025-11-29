export type Field = string | number;

export type poseidonInputType = {
  inputs: Field[];
};

export type poseidonReturnType = Field;

export type TZKInput = {
  root_id_list: Field[];
  root_list: Field[];
  nullifier_hashes: Field[];
  commitment_list: Field[];
  new_commitment_1: Field;
  new_commitment_2: Field;
  token_out: Field;
  amount_out: Field;
  recipient_withdraw: Field;
  secret_in_list: Field[];
  note_index_list: Field[];
  amount_in_list: Field[];
  owner_in: Field;
  token: Field;
  amount_to_send: Field;
  recipient: Field;
  new_secret_sender: Field;
  new_note_index_sender: Field;
  new_secret_recipient: Field;
  new_note_index_recipient: Field;
};

export type TPublicInputTransact = {
  rooiIdList: string[];
  rootList: string[];
  nullifierHashes: string[];
  newCommitment1: string;
  newCommitment2: string | null;
  amountOut: string;
  tokenOut: string;
  recipientWithdraw: string;
};

export type TTransactCommitment = {
  commitmentRecipient: Field;
  secretRecipient: string;
  nullifierRecipient: Field;
  noteRecipient: string;
  recipientNoteIndex: number;
  commitmentChange: Field | null;
  secretChange: string | null;
  nullifierChange: Field | null;
  noteChange: string | null;
  senderNoteIndex: number;
};
