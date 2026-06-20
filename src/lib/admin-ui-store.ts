import { create } from "zustand";

/**
 * UI-only store for the admin shell.
 *
 * Decouples the mobile-nav trigger (lives in <TopHeader />) from the slide-over
 * drawer (lives in <Sidebar />) so a single header/sidebar pair works across
 * every breakpoint without prop-drilling through the Server Component layout.
 *
 * Intentionally NOT persisted — an open mobile drawer should never survive a
 * reload.
 */
interface AdminUiState {
  mobileNavOpen: boolean;
  openMobileNav: () => void;
  closeMobileNav: () => void;
  toggleMobileNav: () => void;
}

export const useAdminUi = create<AdminUiState>((set) => ({
  mobileNavOpen: false,
  openMobileNav: () => set({ mobileNavOpen: true }),
  closeMobileNav: () => set({ mobileNavOpen: false }),
  toggleMobileNav: () => set((s) => ({ mobileNavOpen: !s.mobileNavOpen })),
}));
