"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex, WalletClient, PrivateKeyAccount } from "viem";
import {
  createWallet as createWalletFile,
  importWallet as importWalletFile,
  hasWallet,
  unlockWallet as unlockWalletFile,
  destroyWallet,
  loadNumber,
  saveNumber,
} from "@/lib/wallet";
import { makeWalletClient, publicClient } from "@/lib/chain";

export type WalletState = "loading" | "empty" | "locked" | "unlocked";

interface WalletCtx {
  state: WalletState;
  account?: PrivateKeyAccount;
  address?: `0x${string}`;
  walletClient?: WalletClient;
  number: string;

  createWallet: (password: string) => Promise<Hex>;
  importWallet: (privateKey: Hex, password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => void;
  reset: () => void;

  exportPrivateKey: () => Hex | undefined;
  setNumber: (n: string) => void;
}

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>("loading");
  const [privateKey, setPrivateKey] = useState<Hex | undefined>();
  const [number, setNumberState] = useState<string>("");

  useEffect(() => {
    setState(hasWallet() ? "locked" : "empty");
    setNumberState(loadNumber());
  }, []);

  const account = useMemo(
    () => (privateKey ? privateKeyToAccount(privateKey) : undefined),
    [privateKey],
  );
  const walletClient = useMemo(
    () => (account ? makeWalletClient(account) : undefined),
    [account],
  );

  const create = useCallback(async (password: string) => {
    const { privateKey: pk } = await createWalletFile(password);
    setPrivateKey(pk);
    setState("unlocked");
    return pk;
  }, []);

  const importPK = useCallback(async (pk: Hex, password: string) => {
    await importWalletFile(pk, password);
    setPrivateKey(pk);
    setState("unlocked");
  }, []);

  const unlock = useCallback(async (password: string) => {
    const pk = await unlockWalletFile(password);
    setPrivateKey(pk);
    setState("unlocked");
  }, []);

  const lock = useCallback(() => {
    setPrivateKey(undefined);
    setState(hasWallet() ? "locked" : "empty");
  }, []);

  const reset = useCallback(() => {
    destroyWallet();
    setPrivateKey(undefined);
    setNumberState("");
    setState("empty");
  }, []);

  const setNumber = useCallback((n: string) => {
    saveNumber(n);
    setNumberState(n);
  }, []);

  const exportPrivateKey = useCallback(() => privateKey, [privateKey]);

  const value: WalletCtx = {
    state,
    account,
    address: account?.address,
    walletClient,
    number,
    createWallet: create,
    importWallet: importPK,
    unlock,
    lock,
    reset,
    exportPrivateKey,
    setNumber,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be inside <WalletProvider>");
  return v;
}

export { publicClient };
