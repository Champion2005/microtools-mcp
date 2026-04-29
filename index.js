import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from 'fs/promises';
import * as jsondiffpatch from 'jsondiffpatch';
import lodash from 'lodash';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { PDFDocument } from 'pdf-lib';
import Papa from 'papaparse';
import MarkdownIt from 'markdown-it';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { jwtDecode } from 'jwt-decode';
import cronstrue from 'cronstrue';
import { parseExpression } from 'cron-parser';
import { quicktype, InputData, jsonInputForTargetLanguage } from 'quicktype-core';
import { optimize } from 'svgo';
import { faker } from '@faker-js/faker';

const { capitalize } = lodash;

// Setup DOMPurify
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// Setup MarkdownIt
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

// Create MCP server
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

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "json_diff",
        description: "Compare two JSON payloads and output the differences.",
        inputSchema: {
          type: "object",
          properties: {
            leftJson: { type: "string", description: "Original JSON string" },
            rightJson: { type: "string", description: "Modified JSON string" }
          },
          required: ["leftJson", "rightJson"]
        }
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
            sentenceCase: { type: "boolean", default: false }
          },
          required: ["input"]
        }
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
            quality: { type: "number", description: "Quality from 1 to 100", default: 80 }
          },
          required: ["inputPath", "outputPath"]
        }
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
            errorCorrection: { type: "string", enum: ["L", "M", "Q", "H"], default: "M" }
          },
          required: ["payload", "outputPath"]
        }
      },
      {
        name: "pdf_merge",
        description: "Combine multiple PDF files into one output document.",
        inputSchema: {
          type: "object",
          properties: {
            inputPaths: { type: "array", items: { type: "string" }, description: "Absolute paths to the input PDF files in order" },
            outputPath: { type: "string", description: "Absolute path to save the merged PDF" }
          },
          required: ["inputPaths", "outputPath"]
        }
      },
      {
        name: "csv_to_json",
        description: "Convert a CSV string into a formatted JSON string.",
        inputSchema: {
          type: "object",
          properties: {
            csv: { type: "string", description: "Raw CSV string data" },
            hasHeader: { type: "boolean", default: true },
            delimiter: { type: "string", default: "" } // empty string means auto-detect in papaparse
          },
          required: ["csv"]
        }
      },
      {
        name: "markdown_preview",
        description: "Convert markdown into clean, sanitized HTML.",
        inputSchema: {
          type: "object",
          properties: {
            markdown: { type: "string", description: "Markdown text to convert" }
          },
          required: ["markdown"]
        }
      },
      {
        name: "jwt_inspector",
        description: "Decode and inspect JSON Web Tokens (JWT). Returns the header and payload.",
        inputSchema: {
          type: "object",
          properties: {
            token: { type: "string", description: "The raw JWT string to decode" }
          },
          required: ["token"]
        }
      },
      {
        name: "cron_translator",
        description: "Convert a cron schedule expression into plain English and calculate the next execution times.",
        inputSchema: {
          type: "object",
          properties: {
            cronExpression: { type: "string", description: "The cron expression (e.g. '0 4 8-14 * *')" }
          },
          required: ["cronExpression"]
        }
      }
    ]
  };
});

// Implement tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "json_diff": {
        const leftObj = JSON.parse(args.leftJson);
        const rightObj = JSON.parse(args.rightJson);
        const differ = jsondiffpatch.create({
          objectHash: (obj) => obj.id || obj._id || obj.name || JSON.stringify(obj)
        });
        const delta = differ.diff(leftObj, rightObj);
        return {
          content: [{ type: "text", text: JSON.stringify(delta || { identical: true }, null, 2) }]
        };
      }

      case "text_cleanup": {
        let result = args.input;
        const options = {
          trimLines: args.trimLines ?? true,
          collapseSpaces: args.collapseSpaces ?? true,
          normalizePunctuation: args.normalizePunctuation ?? true,
          removeBlankLines: args.removeBlankLines ?? true,
          sentenceCase: args.sentenceCase ?? false
        };

        if (options.normalizePunctuation) {
          result = result.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/–/g, "-").replace(/—/g, "-");
        }
        if (options.collapseSpaces) {
          result = result.split('\n').map(line => line.replace(/[ \t]+/g, ' ')).join('\n');
        }
        if (options.trimLines) {
          result = result.split('\n').map(line => line.trim()).join('\n');
        }
        if (options.removeBlankLines) {
          result = result.replace(/\n\s*\n\s*\n/g, '\n\n');
        }
        if (options.sentenceCase) {
          result = result.split('\n').map(line => 
            line.split(/([.!?]\s+)/).map(part => /^[.!?]\s+$/.test(part) ? part : capitalize(part)).join('')
          ).join('\n');
        }

        return { content: [{ type: "text", text: result }] };
      }

      case "image_resizer": {
        let transform = sharp(args.inputPath);
        
        if (args.multiplier) {
          const metadata = await transform.metadata();
          const targetWidth = Math.max(1, Math.round(metadata.width * args.multiplier));
          const targetHeight = Math.max(1, Math.round(metadata.height * args.multiplier));
          transform = transform.resize(targetWidth, targetHeight, { fit: 'inside' });
        } else if (args.width || args.height) {
          transform = transform.resize(args.width || null, args.height || null, { fit: 'inside' });
        }

        const format = args.format || 'jpeg';
        const quality = args.quality || 80;

        if (format === 'jpeg') transform = transform.jpeg({ quality });
        if (format === 'png') transform = transform.png({ quality });
        if (format === 'webp') transform = transform.webp({ quality });

        await transform.toFile(args.outputPath);
        return { content: [{ type: "text", text: `Successfully resized image to ${args.outputPath}` }] };
      }

      case "qr_generator": {
        const opts = {
          errorCorrectionLevel: args.errorCorrection || 'M',
          type: args.format === 'svg' ? 'svg' : 'png',
          width: args.size || 300,
        };

        if (args.format === 'svg') {
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
          delimiter: args.delimiter || '',
          skipEmptyLines: true,
        });

        if (result.errors.length > 0) {
          return { content: [{ type: "text", text: JSON.stringify({ data: result.data, warnings: result.errors }, null, 2) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
      }

      case "markdown_preview": {
        const rawHtml = md.render(args.markdown);
        const cleanHtml = DOMPurify.sanitize(rawHtml);
        return { content: [{ type: "text", text: cleanHtml }] };
      }

      case "hash_generator": {
        try {
          const input = args.inputString || '';
          const md5 = CryptoJS.MD5(input).toString();
          const sha1 = CryptoJS.SHA1(input).toString();
          const sha256 = CryptoJS.SHA256(input).toString();
          const sha512 = CryptoJS.SHA512(input).toString();
          const bcryptHash = await bcrypt.hash(input, 8);
          
          const result = {
            hashes: { md5, sha1, sha256, sha512, bcrypt: bcryptHash }
          };

          if (args.generateTokens) {
            const randomWords = CryptoJS.lib.WordArray.random(32);
            result.tokens = {
              uuid: uuidv4(),
              hex32: randomWords.toString(CryptoJS.enc.Hex),
              base64: randomWords.toString(CryptoJS.enc.Base64)
            };
          }

          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Hashing failed: ${err.message}` }] };
        }
      }

      case "cron_translator": {
        try {
          const translation = cronstrue.toString(args.cronExpression, { throwExceptionOnParseError: true });
          const interval = parser.parseExpression(args.cronExpression);
          const upcoming = [];
          for (let i = 0; i < 5; i++) {
            upcoming.push(interval.next().toDate().toISOString());
          }
          return { content: [{ type: "text", text: JSON.stringify({ translation, upcoming }, null, 2) }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Invalid cron expression: ${err.message}` }] };
        }
      }

      case "type_generator": {
        try {
          JSON.parse(args.jsonString);
          const lang = args.language || 'typescript';
          const jsonInputForTarget = await jsonInputForTargetLanguage(lang);
          await jsonInputForTarget.addSource({
            name: args.rootName || 'Root',
            samples: [args.jsonString]
          });
          const inputData = new InputData();
          inputData.addInput(jsonInputForTarget);
          const result = await quicktype({
            inputData,
            lang,
            rendererOptions: { 'just-types': 'true', 'acronym-style': 'original' }
          });
          return { content: [{ type: "text", text: result.lines.join('\n') }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Type generation failed: ${err.message}` }] };
        }
      }

      case "svg_optimizer": {
        try {
          const result = optimize(args.svgString, {
            multipass: true,
            plugins: [
              { name: 'preset-default', params: { overrides: { removeViewBox: false } } },
              'removeDimensions',
              'sortAttrs',
            ],
          });
          if (result.error) throw new Error(result.error);
          return { content: [{ type: "text", text: result.data }] };
        } catch (err) {
          return { content: [{ type: "text", text: `SVG optimization failed: ${err.message}` }] };
        }
      }

      case "mock_data_generator": {
        try {
          const count = Math.min(args.rowCount || 10, 1000);
          faker.seed();
          const data = [];
          for (let i = 0; i < count; i++) {
            const row = {};
            args.schema.forEach(field => {
              switch(field.type) {
                case 'uuid': row[field.name] = faker.string.uuid(); break;
                case 'fullName': row[field.name] = faker.person.fullName(); break;
                case 'email': row[field.name] = faker.internet.email(); break;
                case 'phone': row[field.name] = faker.phone.number(); break;
                case 'jobTitle': row[field.name] = faker.person.jobTitle(); break;
                case 'company': row[field.name] = faker.company.name(); break;
                case 'avatar': row[field.name] = faker.image.avatar(); break;
                case 'date': row[field.name] = faker.date.past().toISOString(); break;
                case 'paragraph': row[field.name] = faker.lorem.paragraph(); break;
                case 'boolean': row[field.name] = faker.datatype.boolean(); break;
                case 'number': row[field.name] = faker.number.int({ min: 1, max: 1000 }); break;
                default: row[field.name] = faker.word.sample();
              }
            });
            data.push(row);
          }
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Mock data generation failed: ${err.message}` }] };
        }
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

// Run the server
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Microtools MCP Server running on stdio");
}

run().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});