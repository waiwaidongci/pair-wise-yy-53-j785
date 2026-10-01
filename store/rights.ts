import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { FrozenMaterial, LicenseWindow, RightsComment } from '@/lib/types'
import { initialComments, initialMaterials, initialWindows } from '@/lib/mock-data'
import { findConflicts, shiftWindow } from '@/lib/rules'

interface RightsState {
  windows: LicenseWindow[]
  comments: RightsComment[]
  materials: FrozenMaterial[]
  selectedWindowId: string
  selectedTerritory: string
  version: number
  updateWindow: (id: string, patch: Partial<LicenseWindow>) => void
  batchShift: (ids: string[], days: number) => void
  acceptComment: (id: string) => void
  addMaterial: (material: FrozenMaterial) => void
  removeMaterial: (id: string) => void
  selectWindow: (id: string) => void
  reset: () => void
}

export const useRightsStore = create<RightsState>()(
  persist(
    (set) => ({
      windows: initialWindows,
      comments: initialComments,
      materials: initialMaterials,
      selectedWindowId: 'RW-102',
      selectedTerritory: '全部地区',
      version: 18,
      updateWindow: (id, patch) => set((state) => ({ windows: state.windows.map((item) => item.id === id ? { ...item, ...patch, status: '草案' } : item), version: state.version + 1 })),
      batchShift: (ids, days) => set((state) => ({ windows: state.windows.map((item) => ids.includes(item.id) ? shiftWindow(item, days) : item), version: state.version + 1 })),
      acceptComment: (id) => set((state) => ({ comments: state.comments.map((item) => item.id === id ? { ...item, resolved: true } : item), version: state.version + 1 })),
      addMaterial: (material) => set((state) => ({ materials: [...state.materials, material], version: state.version + 1 })),
      removeMaterial: (id) => set((state) => ({ materials: state.materials.filter((item) => item.id !== id), version: state.version + 1 })),
      selectWindow: (id) => set({ selectedWindowId: id }),
      reset: () => set({ windows: initialWindows, comments: initialComments, materials: initialMaterials, version: 18 }),
    }),
    { name: 'yy53-rights-draft-v2', version: 2 },
  ),
)

export function useConflicts() {
  const windows = useRightsStore((state) => state.windows)
  return findConflicts(windows)
}
