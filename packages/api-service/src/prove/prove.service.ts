import { randomBytes } from 'crypto';
import { Noir, InputMap, type ForeignCallHandler } from '@noir-lang/noir_js';
import assert from 'assert';
import { EncryptionService } from '@app/shared/utils/encryption.service';
import { MASK_251 } from '@app/shared/utils/constants';
import {
  poseidon2_circuit,
  poseidon4_circuit,
  ZKINPUT_LENGTH,
} from '@app/shared/ztarknet/constants';
import {
  Field,
  TTransactCommitment,
  TZKInput,
} from '@app/shared/ztarknet/type';
import initNoirC from '@noir-lang/noirc_abi';
import initACVM from '@noir-lang/acvm_js';
import { getZKHonkCallData, init } from 'garaga';
import { bytecode, abi } from '../../assets/zkPal.json';
import { DebugFileMap, Abi } from '@noir-lang/types';
import { UltraHonkBackend } from '@aztec/bb.js';
import { CommitmentDocument } from '@app/shared/models/schema';
import { parseUnits } from 'ethers';
import fs from 'fs';
import path from 'path';
export { type ForeignCallHandler } from '@noir-lang/noir_js';

export class Prove {
  static async initWasm() {
    try {
      await Promise.all([
        initACVM('@noir-lang/acvm_js/web/acvm_js_bg.wasm'),
        initNoirC('@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm'),
      ]);
    } catch (error) {
      console.error('Failed to initialize WASM in App component:', error);
    }
  }

  static async loadVk() {
    const response = fs.readFileSync(
      path.join(__dirname, '../../assets/vk.bin'),
    );

    const binaryData = new Uint8Array(response);
    return binaryData;
  }

  static async generateZKProof(inputs: TZKInput): Promise<bigint[]> {
    try {
      // await Prove.initWasm();

      // generate witness
      const noir = new Noir({
        bytecode,
        abi: abi as Abi,
        debug_symbols: '',
        file_map: {} as DebugFileMap,
      });

      const execResult = await noir.execute(inputs);
      // Generate proof
      // Use single thread to avoid worker issues in development
      // You can change to { threads: 2 } or more for production builds
      const honk = new UltraHonkBackend(bytecode, { threads: 1 });
      const proof = await honk.generateProof(execResult.witness, {
        starknetZK: true,
      });
      honk.destroy();

      const vk = await Prove.loadVk();

      // Initialize Garaga
      await init();
      const callData = getZKHonkCallData(
        proof.proof,
        Prove.flattenFieldsAsArray(proof.publicInputs),
        vk as Uint8Array,
        1, // HonkFlavor.STARKNET
      );

      return callData.slice(1);
    } catch (error) {
      throw new Error(error);
    }
  }

  /**
   * Build ZK input
   *
   * @param sender
   * @param token
   * @param amountToSend
   * @param amountOut amount of token to unshield
   * @param recipient
   * @param recipientWithdraw address of the recipient to unshield
   * @param oldCommiments
   * @param newCommitments
   * @returns
   */
  static async buildZKInput(
    sender: string,
    token: string,
    amountToSend: bigint,
    tokenOut: string,
    amountOut: bigint,
    recipient: string,
    recipientWithdraw: string,
    oldCommiments: CommitmentDocument[],
    newCommitments: TTransactCommitment,
  ): Promise<TZKInput> {
    assert(oldCommiments.length > 0, 'Invalid old commitments');
    assert(newCommitments.commitmentRecipient, 'Invalid new commitments');

    const rootIdList: Field[] = Array(ZKINPUT_LENGTH).fill('0');
    const rootList: Field[] = Array(ZKINPUT_LENGTH).fill('0');
    const nullifierHashes: Field[] = Array(ZKINPUT_LENGTH).fill('0');
    const commitmentList: Field[] = Array(ZKINPUT_LENGTH).fill('0');
    const secretInList: Field[] = Array(ZKINPUT_LENGTH).fill('0');
    const noteIndexList: Field[] = Array(ZKINPUT_LENGTH).fill('0');
    const amountInList: Field[] = Array(ZKINPUT_LENGTH).fill('0');

    for (let i = 0; i < oldCommiments.length; i++) {
      rootIdList[i] = oldCommiments[i].rootId;
      rootList[i] = oldCommiments[i].root;
      nullifierHashes[i] = oldCommiments[i].nullifier;
      commitmentList[i] = oldCommiments[i].commitment;
      secretInList[i] = oldCommiments[i].secret;
      noteIndexList[i] = oldCommiments[i].noteIndex.toString();
      amountInList[i] = parseUnits(oldCommiments[i].amount, 18).toString();
    }

    const newCommiment1: Field = newCommitments.commitmentRecipient;
    const newCommiment2: Field = newCommitments.commitmentChange || '0';

    return {
      root_id_list: rootIdList,
      root_list: rootList,
      nullifier_hashes: nullifierHashes,
      commitment_list: commitmentList,
      new_commitment_1: newCommiment1,
      new_commitment_2: newCommiment2,
      token_out: tokenOut,
      amount_out: amountOut.toString(),
      recipient_withdraw: recipientWithdraw,
      secret_in_list: secretInList,
      note_index_list: noteIndexList,
      amount_in_list: amountInList,
      owner_in: EncryptionService.convertStringToHex(sender),
      token: token,
      amount_to_send: amountToSend.toString(),
      recipient: EncryptionService.convertStringToHex(recipient),
      new_secret_sender: newCommitments.secretChange || '0',
      new_note_index_sender: newCommitments.senderNoteIndex.toString(),

      new_secret_recipient: newCommitments.secretRecipient,
      new_note_index_recipient: newCommitments.recipientNoteIndex.toString(),
    };
  }

  static async poseidon2(
    inputs: Field[],
    foreignCallHandler?: ForeignCallHandler,
  ): Promise<Field> {
    assert(inputs.length === 2, 'Invalid inputs length');
    const program = new Noir(poseidon2_circuit);
    const args: InputMap = { inputs };
    const { returnValue } = await program.execute(args, foreignCallHandler);
    return returnValue as Field;
  }

  static async poseidon4(
    inputs: Field[],
    foreignCallHandler?: ForeignCallHandler,
  ): Promise<Field> {
    assert(inputs.length === 4, 'Invalid inputs length');
    const program = new Noir(poseidon4_circuit);
    const args: InputMap = { inputs };
    const { returnValue } = await program.execute(args, foreignCallHandler);
    return returnValue as Field;
  }

  static async createNullifier(secret: string, noteIndex: number) {
    const preImageNullifier = await Prove.poseidon2([secret, noteIndex]);
    const nullifier = await Prove.poseidon2([preImageNullifier, 0]);

    return nullifier;
  }

  static shortenCommitment(commitment: string) {
    return `0x${(BigInt(commitment) & MASK_251).toString(16)}`;
  }

  static async generateShieldCommitment({
    amount, // number | bigint (e.g. 100_000_000 for 100 USDC)
    recipient, // string (Ethereum/Starknet address)
    noteIndex,
  }: {
    amount: bigint;
    recipient: string;
    noteIndex: number;
  }): Promise<{
    commitment: Field;
    secret: string;
    nullifier: Field;
    note: string;
    noteIndex: number;
  }> {
    // 1. Generate random secret & nullifier (32 bytes each)
    const secret = randomBytes(24);
    const nullifier = await Prove.createNullifier(
      '0x' + secret.toString('hex'),
      noteIndex,
    );

    // 3. Convert amount to field element
    const amountField = amount.toString();

    // 4. Compute commitment = Poseidon(secret, nullifier, amount, recipient)
    const commitment = await Prove.poseidon4([
      '0x' + secret.toString('hex'),
      nullifier,
      amountField,
      EncryptionService.convertStringToHex(recipient),
    ]);

    // 6. Create backup note (Tornado-style)
    const note = `privstark-${commitment}-${secret.toString(
      'hex',
    )}-${nullifier.toString()}`;

    return {
      commitment,
      secret: '0x' + secret.toString('hex'),
      nullifier,
      note,
      noteIndex,
    };
  }

  /**
   * Generate transact commitment
   *
   * @param amountToSend
   * @param recipient
   * @param recipientNoteIndex
   * @param changeAmount
   * @param sender
   * @param senderNoteIndex
   * @Note commitmentChange is undefined if changeAmount is 0
   */
  static async generateTransactCommitment({
    amountToSend,
    recipient,
    recipientNoteIndex,
    changeAmount,
    sender,
    senderNoteIndex,
  }: {
    amountToSend: bigint;
    recipient: string;
    recipientNoteIndex: number;
    changeAmount: bigint;
    sender: string;
    senderNoteIndex: number;
  }): Promise<TTransactCommitment> {
    // === 1. Generate fresh randomness for recipient note ===
    const secretRec = randomBytes(24);
    const nullifierRec = await Prove.createNullifier(
      '0x' + secretRec.toString('hex'),
      recipientNoteIndex,
    );

    // === 2. Generate Recipient commitment ===
    const commitmentRec = await Prove.poseidon4([
      '0x' + secretRec.toString('hex'),
      nullifierRec,
      amountToSend.toString(),
      EncryptionService.convertStringToHex(recipient),
    ]);

    // === 3. Generate fresh randomness for change of sender note ===
    let secretChange: NonSharedBuffer | undefined;
    let nullifierChange: Field | undefined;
    let commitmentChange: Field | undefined;
    if (changeAmount > 0n) {
      secretChange = randomBytes(24);
      nullifierChange = await Prove.createNullifier(
        '0x' + secretChange.toString('hex'),
        senderNoteIndex,
      );

      commitmentChange = await Prove.poseidon4([
        '0x' + secretChange.toString('hex'),
        nullifierChange,
        changeAmount.toString(),
        EncryptionService.convertStringToHex(sender),
      ]);
    }

    return {
      // To recipient
      commitmentRecipient: commitmentRec,
      secretRecipient: '0x' + secretRec.toString('hex'),
      nullifierRecipient: nullifierRec,
      noteRecipient: `privstark-${
        '0x' + commitmentRec.toString(16)
      }-${secretRec.toString('hex')}-${nullifierRec.toString()}`,
      recipientNoteIndex,

      // Change note
      commitmentChange: commitmentChange ? commitmentChange : null,
      secretChange: secretChange ? '0x' + secretChange.toString('hex') : null,
      nullifierChange: nullifierChange ? nullifierChange : null,
      noteChange: commitmentChange
        ? `privstark-${
            '0x' + commitmentChange.toString(16)
          }-${secretChange.toString('hex')}-${nullifierChange.toString()}`
        : null,
      senderNoteIndex,
    };
  }

  static flattenFieldsAsArray(fields: string[]): Uint8Array {
    const flattenedPublicInputs = fields.map(Prove.hexToUint8Array);

    return Prove.flattenUint8Arrays(flattenedPublicInputs);
  }

  private static flattenUint8Arrays(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((acc, val) => acc + val.length, 0);

    const result = new Uint8Array(totalLength);

    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }

    return result;
  }

  private static hexToUint8Array(hex: string): Uint8Array {
    const sanitisedHex = BigInt(hex).toString(16).padStart(64, '0');

    const len = sanitisedHex.length / 2;
    const u8 = new Uint8Array(len);

    let i = 0;
    let j = 0;
    while (i < len) {
      u8[i] = parseInt(sanitisedHex.slice(j, j + 2), 16);
      i += 1;
      j += 2;
    }

    return u8;
  }
}
