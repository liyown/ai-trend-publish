declare module "marked" {
  interface MarkedStatic {
    lexer(markdown: string): unknown[];
  }

  export const marked: MarkedStatic;
}

export {};
