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
cd vendor/odoo && git sparse-checkout init --cone && git sparse-checkout set odoo/addons/base addons/web addons/sale ... && git checkout 19.0

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
