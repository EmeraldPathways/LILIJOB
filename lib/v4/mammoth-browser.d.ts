declare module "mammoth/mammoth.browser.js" {
  type MammothResult = { value: string; messages: Array<{ type: string; message: string; error?: unknown }> };
  const mammoth: {
    extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<MammothResult>;
  };
  export default mammoth;
}
