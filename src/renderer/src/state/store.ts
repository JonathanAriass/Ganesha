import { create } from 'zustand'

type ConnectionModalState =
  | { mode: 'create' }
  | { mode: 'edit'; id: string }

interface AppState {
  activeConnectionId: string | null
  connectionModal: ConnectionModalState | null

  setActiveConnection: (id: string | null) => void
  openModal: (state: ConnectionModalState) => void
  closeModal: () => void
}

export const useAppStore = create<AppState>((set) => ({
  activeConnectionId: null,
  connectionModal: null,

  setActiveConnection: (id) => set({ activeConnectionId: id }),
  openModal: (state) => set({ connectionModal: state }),
  closeModal: () => set({ connectionModal: null }),
}))
