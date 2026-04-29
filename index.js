import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import * as jsondiffpatch from "jsondiffpatch";
import lodash from "lodash";
import sharp from "sharp";
import QRCode from "qrcode";
import { PDFDocument } from "pdf-lib";
import Papa from "papaparse";
import MarkdownIt from "markdown-it";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { jwtDecode } from "jwt-decode";
import cronstrue from "cronstrue";
import { CronExpressionParser } from "cron-parser";
import { quicktype, InputData, jsonInputForTargetLanguage } from "quicktype-core";
import { optimize } from "svgo";
import { faker } from "@faker-js/faker";
import CryptoJS from "crypto-js";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

const { capitalize } = lodash;

const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

const server = new Server(
  {
    name: "microtools-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const TOOLS = [
  {
    name: "json_diff",
    description: "Compare two JSON payloads and output the differences.",
    inputSchema: {
      type: "object",
      properties: {
        leftJson: { type: "string", description: "Original JSON string" },
        rightJson: { type: "string", description: "Modified JSON string" },
      },
      required: ["leftJson", "rightJson"],
    },
  },
  {
    name: "text_cleanup",
    description: "Clean text by normalizing spacing, punctuation, and casing.",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string", description: "Text to clean" },
        trimLines: { type: "boolean", default: true },
        collapseSpaces: { type: "boolean", default: true },
        normalizePunctuation: { type: "boolean", default: true },
        removeBlankLines: { type: "boolean", default: true },
        sentenceCase: { type: "boolean", default: false },
      },
      required: ["input"],
    },
  },
  {
    name: "image_resizer",
    description: "Resize an image file to specific dimensions or a multiplier scale.",
    inputSchema: {
      type: "object",
      properties: {
        inputPath: { type: "string", description: "Absolute path to the input image file" },
        outputPath: { type: "string", description: "Absolute path to save the output image" },
        width: { type: "number", description: "Target width (px)" },
        height: { type: "number", description: "Target height (px)" },
        multiplier: { type: "number", description: "Scale multiplier (e.g. 0.5 for half size)" },
        format: { type: "string", enum: ["jpeg", "png", "webp"], default: "jpeg" },
        quality: { type: "number", description: "Quality from 1 to 100", default: 80 },
      },
      required: ["inputPath", "outputPath"],
    },
  },
  {
    name: "qr_generator",
    description: "Generate a QR code and save it as a PNG or SVG file.",
    inputSchema: {
      type: "object",
      properties: {
        payload: { type: "string", description: "Content to encode in the QR code" },
        outputPath: { type: "string", description: "Absolute path to save the QR code (.png or .svg)" },
        format: { type: "string", enum: ["png", "svg"], default: "png" },
        size: { type: "number", description: "Output size in px", default: 300 },
        errorCorrection: { type: "string", enum: ["L", "M", "Q", "H"], default: "M" },
      },
      required: ["payload", "outputPath"],
    },
  },
  {
    name: "pdf_merge",
    description: "Combine multiple PDF files into one output document.",
    inputSchema: {
      type: "object",
      properties: {
        inputPaths: {
          type: "array",
          items: { type: "string" },
          description: "Absolute paths to the input PDF files in order",
        },
        outputPath: { type: "string", description: "Absolute path to save the merged PDF" },
      },
      required: ["inputPaths", "outputPath"],
    },
  },
  {
    name: "csv_to_json",
    description: "Convert a CSV string into a formatted JSON string.",
    inputSchema: {
      type: "object",
      properties: {
        csv: { type: "string", description: "Raw CSV string data" },
        hasHeader: { type: "boolean", default: true },
        delimiter: { type: "string", default: "" },
      },
      required: ["csv"],
    },
  },
  {
    name: "markdown_preview",
    description: "Convert markdown into clean, sanitized HTML.",
    inputSchema: {
      type: "object",
      properties: {
        markdown: { type: "string", description: "Markdown text to convert" },
      },
      required: ["markdown"],
    },
  },
  {
    name: "jwt_inspector",
    description: "Decode and inspect JSON Web Tokens (JWT). Returns the header and payload.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "The raw JWT string to decode" },
      },
      required: ["token"],
    },
  },
  {
    name: "hash_generator",
    description: "Generate MD5/SHA/Bcrypt hashes and optional secure tokens.",
    inputSchema: {
      type: "object",
      properties: {
        inputString: { type: "string", description: "Input text to hash" },
        generateTokens: { type: "boolean", default: false },
      },
      required: ["inputString"],
    },
  },
  {
    name: "cron_translator",
    description: "Convert a cron expression to plain English and next execution times.",
    inputSchema: {
      type: "object",
      properties: {
        cronExpression: { type: "string", description: "Cron expression (e.g. '*/5 * * * *')" },
      },
      required: ["cronExpression"],
    },
  },
  {
    name: "type_generator",
    description: "Generate static types from JSON payloads.",
    inputSchema: {
      type: "object",
      properties: {
        jsonString: { type: "string", description: "A valid JSON object/array string" },
        language: {
          type: "string",
          enum: ["typescript", "go", "rust", "python", "swift", "kotlin", "csharp", "java"],
          default: "typescript",
        },
        rootName: { type: "string", default: "Root" },
      },
      required: ["jsonString"],
    },
  },
  {
    name: "svg_optimizer",
    description: "Optimize and minify SVG markup.",
    inputSchema: {
      type: "object",
      properties: {
        svgString: { type: "string", description: "Raw SVG markup" },
      },
      required: ["svgString"],
    },
  },
  {
    name: "mock_data_generator",
    description: "Generate realistic mock records from a schema.",
    inputSchema: {
      type: "object",
      properties: {
        rowCount: { type: "number", default: 10 },
        schema: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string" },
            },
            required: ["name", "type"],
          },
        },
      },
      required: ["schema"],
    },
  },
  {
    name: "regex_playground",
    description: "Run and inspect regex matches against test text.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern without delimiters" },
        flags: { type: "string", default: "g", description: "Regex flags (e.g. gmi)" },
        testString: { type: "string", description: "Input string to match against" },
        maxMatches: { type: "number", default: 100, description: "Max matches to return (1-1000)" },
      },
      required: ["pattern", "testString"],
    },
  },
  {
    name: "curl_to_code",
    description: "Convert a curl command into JavaScript, Python, and Go code snippets.",
    inputSchema: {
      type: "object",
      properties: {
        curl: { type: "string", description: "Raw curl command string" },
      },
      required: ["curl"],
    },
  },
  {
    name: "color_extractor",
    description: "Extract dominant colors from an image and compute contrast ratios.",
    inputSchema: {
      type: "object",
      properties: {
        inputPath: { type: "string", description: "Absolute path to image file" },
        maxColors: { type: "number", default: 6, description: "How many top colors to return" },
        sampleStride: { type: "number", default: 10, description: "Pixel stride for sampling speed" },
        snap: { type: "number", default: 16, description: "Channel rounding bucket size (1-64)" },
        minAlpha: { type: "number", default: 200, description: "Ignore pixels with alpha below this value" },
      },
      required: ["inputPath"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

function toJsonText(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function stripQuotes(value) {
  if (!value) return value;
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function tokenizeShell(command) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }

    if (ch === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}

function parseCurl(curlCommand) {
  const tokens = tokenizeShell(curlCommand.replace(/\\\s*\n/g, " "));
  const parsed = {
    method: "GET",
    url: "",
    headers: {},
    data: null,
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens[i + 1];

    if (token === "curl") continue;

    if (token === "-X" || token === "--request") {
      if (next) {
        parsed.method = next.toUpperCase();
        i++;
      }
      continue;
    }

    if (token === "-H" || token === "--header") {
      if (next) {
        const rawHeader = stripQuotes(next);
        const colonIndex = rawHeader.indexOf(":");
        if (colonIndex > -1) {
          const key = rawHeader.slice(0, colonIndex).trim();
          const value = rawHeader.slice(colonIndex + 1).trim();
          if (key) parsed.headers[key] = value;
        }
        i++;
      }
      continue;
    }

    if (
      token === "-d" ||
      token === "--data" ||
      token === "--data-raw" ||
      token === "--data-binary" ||
      token === "--data-urlencode"
    ) {
      if (next) {
        parsed.data = stripQuotes(next);
        if (parsed.method === "GET") parsed.method = "POST";
        i++;
      }
      continue;
    }

    if (token === "--url" && next) {
      parsed.url = stripQuotes(next);
      i++;
      continue;
    }

    if (!parsed.url && /^https?:\/\//i.test(token)) {
      parsed.url = stripQuotes(token);
    }
  }

  if (!parsed.url) {
    throw new Error("No URL found in curl command.");
  }

  return parsed;
}

function isJsonString(value) {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function generateCurlCode(parsed) {
  const { method, url, headers, data } = parsed;
  const headersJson = JSON.stringify(headers, null, 2);
  const bodyIsJson = isJsonString(data);
  const bodyLiteral = bodyIsJson ? JSON.stringify(JSON.parse(data), null, 2) : JSON.stringify(data ?? "");

  const javascript = `fetch(${JSON.stringify(url)}, {
  method: ${JSON.stringify(method)},
  headers: ${headersJson}${data !== null ? `,\n  body: ${bodyIsJson ? `JSON.stringify(${bodyLiteral})` : bodyLiteral}` : ""}
})
  .then((res) => res.json())
  .then((data) => console.log(data));`;

  const python = `import requests

url = ${JSON.stringify(url)}
headers = ${headersJson}
${data !== null ? `payload = ${bodyLiteral}\n` : ""}response = requests.request(${JSON.stringify(
    method
  )}, url, headers=headers${data !== null ? ", json=payload" : ""})
print(response.json())`;

  const goHeaders = Object.entries(headers)
    .map(([k, v]) => `\treq.Header.Add(${JSON.stringify(k)}, ${JSON.stringify(v)})`)
    .join("\n");

  const go = `package main

import (
\t"fmt"
\t"io"
\t"net/http"
${data !== null ? '\t"strings"' : ""}
)

func main() {
\turl := ${JSON.stringify(url)}
${data !== null ? `\tpayload := strings.NewReader(${JSON.stringify(data)})` : ""}
\treq, err := http.NewRequest(${JSON.stringify(method)}, url, ${data !== null ? "payload" : "nil"})
\tif err != nil {
\t\tpanic(err)
\t}
${goHeaders}

\tres, err := http.DefaultClient.Do(req)
\tif err != nil {
\t\tpanic(err)
\t}
\tdefer res.Body.Close()

\tbody, err := io.ReadAll(res.Body)
\tif err != nil {
\t\tpanic(err)
\t}
\tfmt.Println(string(body))
}`;

  return { javascript, python, go };
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function luminance(r, g, b) {
  const arr = [r, g, b].map((v) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return arr[0] * 0.2126 + arr[1] * 0.7152 + arr[2] * 0.0722;
}

function contrastRatio(l1, l2) {
  const brightest = Math.max(l1, l2);
  const darkest = Math.min(l1, l2);
  return (brightest + 0.05) / (darkest + 0.05);
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "json_diff": {
        const leftObj = JSON.parse(args.leftJson);
        const rightObj = JSON.parse(args.rightJson);
        const differ = jsondiffpatch.create({
          objectHash: (obj) => obj.id || obj._id || obj.name || JSON.stringify(obj),
        });
        const delta = differ.diff(leftObj, rightObj);
        return toJsonText(delta || { identical: true });
      }

      case "text_cleanup": {
        let result = args.input;
        const options = {
          trimLines: args.trimLines ?? true,
          collapseSpaces: args.collapseSpaces ?? true,
          normalizePunctuation: args.normalizePunctuation ?? true,
          removeBlankLines: args.removeBlankLines ?? true,
          sentenceCase: args.sentenceCase ?? false,
        };

        if (options.normalizePunctuation) {
          result = result
            .replace(/[‘’]/g, "'")
            .replace(/[“”]/g, '"')
            .replace(/…/g, "...")
            .replace(/–/g, "-")
            .replace(/—/g, "-");
        }
        if (options.collapseSpaces) {
          result = result
            .split("\n")
            .map((line) => line.replace(/[ \t]+/g, " "))
            .join("\n");
        }
        if (options.trimLines) {
          result = result
            .split("\n")
            .map((line) => line.trim())
            .join("\n");
        }
        if (options.removeBlankLines) {
          result = result.replace(/\n\s*\n\s*\n/g, "\n\n");
        }
        if (options.sentenceCase) {
          result = result
            .split("\n")
            .map((line) =>
              line
                .split(/([.!?]\s+)/)
                .map((part) => (/^[.!?]\s+$/.test(part) ? part : capitalize(part)))
                .join("")
            )
            .join("\n");
        }

        return { content: [{ type: "text", text: result }] };
      }

      case "image_resizer": {
        let transform = sharp(args.inputPath);

        if (args.multiplier) {
          const metadata = await transform.metadata();
          const targetWidth = Math.max(1, Math.round((metadata.width || 1) * args.multiplier));
          const targetHeight = Math.max(1, Math.round((metadata.height || 1) * args.multiplier));
          transform = transform.resize(targetWidth, targetHeight, { fit: "inside" });
        } else if (args.width || args.height) {
          transform = transform.resize(args.width || null, args.height || null, { fit: "inside" });
        }

        const format = args.format || "jpeg";
        const quality = args.quality || 80;

        if (format === "jpeg") transform = transform.jpeg({ quality });
        if (format === "png") transform = transform.png({ quality });
        if (format === "webp") transform = transform.webp({ quality });

        await transform.toFile(args.outputPath);
        return { content: [{ type: "text", text: `Successfully resized image to ${args.outputPath}` }] };
      }

      case "qr_generator": {
        const opts = {
          errorCorrectionLevel: args.errorCorrection || "M",
          type: args.format === "svg" ? "svg" : "png",
          width: args.size || 300,
        };

        if (args.format === "svg") {
          const svgString = await QRCode.toString(args.payload, opts);
          await fs.writeFile(args.outputPath, svgString);
        } else {
          await QRCode.toFile(args.outputPath, args.payload, opts);
        }

        return { content: [{ type: "text", text: `Successfully generated QR code at ${args.outputPath}` }] };
      }

      case "pdf_merge": {
        const mergedPdf = await PDFDocument.create();

        for (const filePath of args.inputPaths) {
          const pdfBytes = await fs.readFile(filePath);
          const pdf = await PDFDocument.load(pdfBytes);
          const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
          copiedPages.forEach((page) => mergedPdf.addPage(page));
        }

        const mergedPdfBytes = await mergedPdf.save();
        await fs.writeFile(args.outputPath, mergedPdfBytes);

        return { content: [{ type: "text", text: `Successfully merged PDFs to ${args.outputPath}` }] };
      }

      case "csv_to_json": {
        const result = Papa.parse(args.csv.trim(), {
          header: args.hasHeader ?? true,
          delimiter: args.delimiter || "",
          skipEmptyLines: true,
        });

        if (result.errors.length > 0) {
          return toJsonText({ data: result.data, warnings: result.errors });
        }
        return toJsonText(result.data);
      }

      case "markdown_preview": {
        const rawHtml = md.render(args.markdown);
        const cleanHtml = DOMPurify.sanitize(rawHtml);
        return { content: [{ type: "text", text: cleanHtml }] };
      }

      case "jwt_inspector": {
        const decodedPayload = jwtDecode(args.token);
        const tokenParts = args.token.split(".");
        if (tokenParts.length < 2) {
          throw new Error("Invalid JWT format.");
        }
        const decodedHeader = JSON.parse(Buffer.from(tokenParts[0], "base64url").toString("utf8"));
        return toJsonText({ header: decodedHeader, payload: decodedPayload });
      }

      case "hash_generator": {
        const input = args.inputString || "";
        const md5 = CryptoJS.MD5(input).toString();
        const sha1 = CryptoJS.SHA1(input).toString();
        const sha256 = CryptoJS.SHA256(input).toString();
        const sha512 = CryptoJS.SHA512(input).toString();
        const bcryptHash = await bcrypt.hash(input, 8);

        const result = {
          hashes: { md5, sha1, sha256, sha512, bcrypt: bcryptHash },
        };

        if (args.generateTokens) {
          const randomWords = CryptoJS.lib.WordArray.random(32);
          result.tokens = {
            uuid: uuidv4(),
            hex32: randomWords.toString(CryptoJS.enc.Hex),
            base64: randomWords.toString(CryptoJS.enc.Base64),
          };
        }

        return toJsonText(result);
      }

      case "cron_translator": {
        const translation = cronstrue.toString(args.cronExpression, { throwExceptionOnParseError: true });
        const interval = CronExpressionParser.parse(args.cronExpression);
        const upcoming = [];
        for (let i = 0; i < 5; i++) {
          upcoming.push(interval.next().toDate().toISOString());
        }
        return toJsonText({ translation, upcoming });
      }

      case "type_generator": {
        JSON.parse(args.jsonString);
        const lang = args.language || "typescript";
        const jsonInputForTarget = jsonInputForTargetLanguage(lang);
        await jsonInputForTarget.addSource({
          name: args.rootName || "Root",
          samples: [args.jsonString],
        });
        const inputData = new InputData();
        inputData.addInput(jsonInputForTarget);
        const result = await quicktype({
          inputData,
          lang,
          rendererOptions: { "just-types": "true", "acronym-style": "original" },
        });
        return { content: [{ type: "text", text: result.lines.join("\n") }] };
      }

      case "svg_optimizer": {
        const result = optimize(args.svgString, {
          multipass: true,
          plugins: [
            { name: "preset-default", params: { overrides: { removeViewBox: false } } },
            "removeDimensions",
            "sortAttrs",
          ],
        });
        if (result.error) throw new Error(result.error);
        return { content: [{ type: "text", text: result.data }] };
      }

      case "mock_data_generator": {
        const count = Math.min(args.rowCount || 10, 1000);
        faker.seed();
        const data = [];
        for (let i = 0; i < count; i++) {
          const row = {};
          args.schema.forEach((field) => {
            switch (field.type) {
              case "uuid":
                row[field.name] = faker.string.uuid();
                break;
              case "fullName":
                row[field.name] = faker.person.fullName();
                break;
              case "email":
                row[field.name] = faker.internet.email();
                break;
              case "phone":
                row[field.name] = faker.phone.number();
                break;
              case "jobTitle":
                row[field.name] = faker.person.jobTitle();
                break;
              case "company":
                row[field.name] = faker.company.name();
                break;
              case "avatar":
                row[field.name] = faker.image.avatar();
                break;
              case "date":
                row[field.name] = faker.date.past().toISOString();
                break;
              case "paragraph":
                row[field.name] = faker.lorem.paragraph();
                break;
              case "boolean":
                row[field.name] = faker.datatype.boolean();
                break;
              case "number":
                row[field.name] = faker.number.int({ min: 1, max: 1000 });
                break;
              default:
                row[field.name] = faker.word.sample();
            }
          });
          data.push(row);
        }
        return toJsonText(data);
      }

      case "regex_playground": {
        const pattern = args.pattern;
        const flags = args.flags ?? "g";
        const testString = args.testString;
        const limit = Math.max(1, Math.min(args.maxMatches ?? 100, 1000));
        const regex = new RegExp(pattern, flags);

        const matches = [];
        if (regex.global) {
          let match;
          while ((match = regex.exec(testString)) !== null && matches.length < limit) {
            matches.push({
              match: match[0],
              index: match.index,
              groups: match.groups || {},
              captures: match.slice(1),
            });
            if (match[0].length === 0) regex.lastIndex++;
          }
        } else {
          const match = regex.exec(testString);
          if (match) {
            matches.push({
              match: match[0],
              index: match.index,
              groups: match.groups || {},
              captures: match.slice(1),
            });
          }
        }

        return toJsonText({
          pattern,
          flags,
          matchCount: matches.length,
          truncated: matches.length === limit && regex.global,
          matches,
        });
      }

      case "curl_to_code": {
        const parsed = parseCurl(args.curl);
        const snippets = generateCurlCode(parsed);
        return toJsonText({
          parsed,
          snippets,
        });
      }

      case "color_extractor": {
        const maxColors = Math.max(1, Math.min(args.maxColors ?? 6, 20));
        const sampleStride = Math.max(1, Math.min(args.sampleStride ?? 10, 100));
        const snap = Math.max(1, Math.min(args.snap ?? 16, 64));
        const minAlpha = Math.max(0, Math.min(args.minAlpha ?? 200, 255));

        const { data, info } = await sharp(args.inputPath)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });

        const colorCounts = new Map();
        const channels = info.channels || 4;

        for (let i = 0; i < data.length; i += channels * sampleStride) {
          const alpha = data[i + 3] ?? 255;
          if (alpha < minAlpha) continue;

          const r = Math.min(255, Math.round(data[i] / snap) * snap);
          const g = Math.min(255, Math.round(data[i + 1] / snap) * snap);
          const b = Math.min(255, Math.round(data[i + 2] / snap) * snap);
          const key = `${r},${g},${b}`;
          colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
        }

        const colors = [...colorCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, maxColors)
          .map(([key, count], index) => {
            const [r, g, b] = key.split(",").map(Number);
            const hex = rgbToHex(r, g, b);
            const lum = luminance(r, g, b);
            const contrastWhite = Number(contrastRatio(lum, 1).toFixed(2));
            const contrastBlack = Number(contrastRatio(lum, 0).toFixed(2));
            return {
              index: index + 1,
              hex,
              rgb: { r, g, b },
              count,
              contrast: {
                white: contrastWhite,
                black: contrastBlack,
                recommendedText: contrastWhite >= contrastBlack ? "white" : "black",
              },
            };
          });

        const cssVariables = colors.map((c, i) => `--color-${i + 1}: ${c.hex};`).join("\n");
        return toJsonText({
          image: {
            width: info.width,
            height: info.height,
            channels: info.channels,
            sampledPixels: Math.floor(data.length / (channels * sampleStride)),
          },
          colors,
          css: `:root {\n${cssVariables}\n}`,
        });
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error executing tool: ${error.message}` }],
    };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Microtools MCP Server running on stdio");
}

run().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
