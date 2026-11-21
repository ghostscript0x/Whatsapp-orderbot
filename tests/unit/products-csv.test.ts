import { describe, expect, it } from "vitest";
import { CSV_MAX_ROWS, parseProductCsv } from "@/lib/products-csv";

describe("parseProductCsv", () => {
  it("parses valid rows with all columns", () => {
    const csv = [
      "name,price,description,category,image_url",
      'Jollof Rice,"1,500",Smoky party jollof,Mains,https://cdn.example.com/jollof.jpg',
      "Chapman,800.5,,Drinks,",
    ].join("\n");
    const { rows, errors } = parseProductCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { row: 2, name: "Jollof Rice", priceKobo: 150000, description: "Smoky party jollof", category: "Mains", imageUrl: "https://cdn.example.com/jollof.jpg" },
      { row: 3, name: "Chapman", priceKobo: 80050, description: "", category: "Drinks", imageUrl: null },
    ]);
  });

  it("accepts header aliases, extra columns, BOM, CRLF and any column order", () => {
    const csv = "﻿ Price ,Name,imageUrl,notes\r\n2000,Suya,,ignored\r\n";
    const { rows, errors } = parseProductCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ row: 2, name: "Suya", priceKobo: 200000, description: "", category: null, imageUrl: null }]);
  });

  it("reports invalid rows with their spreadsheet row number and keeps valid ones", () => {
    const csv = [
      "name,price,image_url",
      ",1000,",
      "Puff puff,abc,",
      "Moi moi,0,",
      "Zobo,500,ftp://x/y.png",
      "Meat pie,700,",
    ].join("\n");
    const { rows, errors } = parseProductCsv(csv);
    expect(rows.map((r) => r.name)).toEqual(["Meat pie"]);
    expect(errors.map((e) => e.row)).toEqual([2, 3, 4, 5]);
    expect(errors[0].message).toMatch(/Name is required/);
    expect(errors[1].message).toMatch(/not a valid amount/);
    expect(errors[2].message).toMatch(/greater than 0/);
    expect(errors[3].message).toMatch(/http/);
  });

  it("skips blank lines without shifting row numbers", () => {
    const csv = "name,price\n\nRice,100\n,\nBeans,-5\n";
    const { rows, errors } = parseProductCsv(csv);
    expect(rows).toEqual([expect.objectContaining({ row: 3, name: "Rice", priceKobo: 10000 })]);
    expect(errors).toEqual([{ row: 5, message: expect.stringMatching(/not a valid amount/) }]);
  });

  it("rejects a file missing required columns", () => {
    const { rows, errors } = parseProductCsv("title,cost\nRice,100");
    expect(rows).toEqual([]);
    expect(errors).toEqual([{ row: 1, message: "Missing required column(s): name, price" }]);
  });

  it("rejects an empty file and a header-only file", () => {
    expect(parseProductCsv("").errors[0].message).toMatch(/empty/);
    expect(parseProductCsv("name,price\n").errors[0].message).toMatch(/no product rows/);
  });

  it(`rejects more than ${CSV_MAX_ROWS} rows`, () => {
    const lines = ["name,price", ...Array.from({ length: CSV_MAX_ROWS + 1 }, (_, i) => `Item ${i},100`)];
    const { rows, errors } = parseProductCsv(lines.join("\n"));
    expect(rows).toEqual([]);
    expect(errors[0].message).toMatch(/Too many rows/);
  });

  it(`accepts exactly ${CSV_MAX_ROWS} rows`, () => {
    const lines = ["name,price", ...Array.from({ length: CSV_MAX_ROWS }, (_, i) => `Item ${i},100`)];
    expect(parseProductCsv(lines.join("\n")).rows).toHaveLength(CSV_MAX_ROWS);
  });

  it("rejects over-long fields and too-large prices", () => {
    const csv = `name,price,category\n${"x".repeat(121)},100,\nRice,100,${"c".repeat(61)}\nGold,99999999,`;
    const { errors } = parseProductCsv(csv);
    expect(errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect(errors[2].message).toMatch(/too large/);
  });
});
