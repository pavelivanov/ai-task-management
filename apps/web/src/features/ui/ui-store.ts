import { create } from 'zustand';

interface UiState {
  addToPlanOpen: boolean;
  mobileNavOpen: boolean;
  setAddToPlanOpen(open: boolean): void;
  setMobileNavOpen(open: boolean): void;
}

export const useUiStore = create<UiState>()((set) => ({
  addToPlanOpen: false,
  mobileNavOpen: false,
  setAddToPlanOpen: (addToPlanOpen) => set({ addToPlanOpen }),
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
}));
