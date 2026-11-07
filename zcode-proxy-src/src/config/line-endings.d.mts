/** "\r\n" when `source` has more CRLF than bare LF line breaks, else "\n". */
export declare function lineEndingOf(source: string): "\r\n" | "\n";

/** `text` with the line endings `source` uses (every break, CRLF or LF, converted). */
export declare function withLineEndingsOf(source: string, text: string): string;
