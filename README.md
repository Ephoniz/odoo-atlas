# Odoo Atlas

A navigable map of the Odoo system: modules, ORM models, fields, methods and their
override strata, OWL components, services, registries, templates, and the RPC
seam between the JavaScript client and the Python server. Every node is clickable
and opens an inspector with source, relations and inheritance.

Static analysis only. No running Odoo instance is needed.

## Layout

```
extractor/      Python package + one Node script. Parses an Odoo checkout.
web/            Vite + React + TypeScript site that renders the graph.
vendor/odoo     Sparse checkout of odoo/odoo (gitignored).
```

## Build the data

```
# one-time: get the Odoo source
git clone --filter=blob:none --no-checkout --depth 1 --branch 19.0 https://github.com/odoo/odoo.git vendor/odoo
cd vendor/odoo && git sparse-checkout set odoo/addons/base addons/web addons/bus addons/web_tour addons/mail addons/uom addons/analytic addons/portal addons/product addons/account addons/payment addons/account_payment addons/sales_team addons/utm addons/sale addons/sale_stock addons/stock && git checkout 19.0 && cd ../..

# one-time: JS parser deps
cd extractor && npm install

# extract -> web/public/data
python -m extractor --odoo vendor/odoo --out web/public/data
```

## Run the site

```
cd web
npm install
npm run dev
```

## Deploy

`.github/workflows/pages.yml` fetches Odoo, runs the extractor and publishes `web/dist`
to GitHub Pages on every push to `main`. Enable it once under
*Settings → Pages → Source: GitHub Actions*. Run it manually with a different
`odoo_branch` (e.g. `18.0`) to chart another version.
