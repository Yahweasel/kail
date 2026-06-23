ROLLUP=\
	server.mjs \
	static/kail.mjs \
	plugins/client/comfy.mjs \
	plugins/server/comfy.mjs \
	plugins/server/mcp.mjs \
	plugins/client/mcp.mjs \
	plugins/client/render_svg.mjs \
	plugins/client/run_js.mjs

ALL=$(ROLLUP) \
	static/localforage.min.js

all: $(ALL)

$(ROLLUP): src/*/*.ts src/*/*/*.ts node_modules/.bin/rollup
	npm run build

static/localforage.min.js: node_modules/.bin/rollup
	cp node_modules/localforage/dist/localforage.min.js $@

node_modules/.bin/rollup:
	npm install

clean:
	rm -f $(ALL)
