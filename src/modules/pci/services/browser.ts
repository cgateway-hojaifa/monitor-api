import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser } from "puppeteer-core";

/**
 * Headless Chromium for the PCI module (page scans + PDF reports). `CHROME_EXECUTABLE_PATH` lets a
 * Chrome installed on the server replace the bundled `@sparticuz/chromium` binary.
 */
export async function launchBrowser(viewport = { width: 1280, height: 800 }): Promise<Browser> {
  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: viewport,
    executablePath: process.env.CHROME_EXECUTABLE_PATH || (await chromium.executablePath()),
    headless: true,
  });
}
