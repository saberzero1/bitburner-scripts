export * from "SRC/Go/Enums";
const names = () => new Proxy({}, { get: (_t, k) => String(k) });
export const AugmentationName: any = names();
export const FactionName: any = names();
export const CompletedProgramName: any = names();
