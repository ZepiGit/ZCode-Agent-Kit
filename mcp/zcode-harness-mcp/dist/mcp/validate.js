/**
 * Minimal JSON-Schema argument validation for the tool inputSchemas declared
 * in tools.ts (audit D-09: the low-level SDK Server does not validate
 * `arguments`, so enum/type/required/additionalProperties were never
 * enforced). Supports exactly the subset those schemas use: object with
 * properties/required/additionalProperties, string (enum), number/integer
 * (minimum/maximum), boolean, object (free-form), array of strings.
 */
export class ArgumentError extends Error {
    constructor(message) {
        super(`INVALID_ARGUMENTS: ${message}`);
        this.name = "ArgumentError";
    }
}
function check(value, schema, at) {
    if (schema.enum && !schema.enum.includes(value)) {
        throw new ArgumentError(`${at} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`);
    }
    switch (schema.type) {
        case "string":
            if (typeof value !== "string")
                throw new ArgumentError(`${at} must be a string`);
            return;
        case "boolean":
            if (typeof value !== "boolean")
                throw new ArgumentError(`${at} must be a boolean`);
            return;
        case "number":
        case "integer": {
            if (typeof value !== "number" || !Number.isFinite(value))
                throw new ArgumentError(`${at} must be a finite number`);
            if (schema.type === "integer" && !Number.isInteger(value))
                throw new ArgumentError(`${at} must be an integer`);
            if (schema.minimum !== undefined && value < schema.minimum)
                throw new ArgumentError(`${at} must be >= ${schema.minimum}`);
            if (schema.maximum !== undefined && value > schema.maximum)
                throw new ArgumentError(`${at} must be <= ${schema.maximum}`);
            return;
        }
        case "array":
            if (!Array.isArray(value))
                throw new ArgumentError(`${at} must be an array`);
            if (schema.items)
                value.forEach((item, i) => check(item, schema.items, `${at}[${i}]`));
            return;
        case "object": {
            if (value === null || typeof value !== "object" || Array.isArray(value))
                throw new ArgumentError(`${at} must be an object`);
            const obj = value;
            for (const key of schema.required ?? []) {
                if (!Object.hasOwn(obj, key) || obj[key] === undefined)
                    throw new ArgumentError(`${at === "arguments" ? "" : at + "."}${key} is required`);
            }
            const properties = schema.properties ?? {};
            for (const [key, sub] of Object.entries(properties)) {
                if (Object.hasOwn(obj, key) && obj[key] !== undefined)
                    check(obj[key], sub, at === "arguments" ? key : `${at}.${key}`);
            }
            if (schema.additionalProperties === false) {
                const unknown = Object.keys(obj).filter((k) => !Object.hasOwn(properties, k));
                if (unknown.length > 0)
                    throw new ArgumentError(`unknown argument(s): ${unknown.join(", ")}`);
            }
            return;
        }
        default:
            throw new ArgumentError(`${at} has an unsupported schema type`);
    }
}
/** Throws ArgumentError when `args` do not satisfy `schema`. */
export function validateArguments(schema, args) {
    check(args, schema, "arguments");
}
