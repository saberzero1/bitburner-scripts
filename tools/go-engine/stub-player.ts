// Only what the Go code reads. The search always passes an RNG seed, so totalPlaytime is unused.
export const Player: any = {
  totalPlaytime: 1,
  skills: { charisma: 1 },
  mults: { crime_success: 1 },
  hasAugmentation: () => false,
  activeSourceFileLvl: () => 0,
  bitNodeN: 1,
};
