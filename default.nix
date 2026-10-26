{
  buildDenoPackage,
  coreutils,
  darwin,
  deno,
  git,
  lib,
  makeWrapper,
  nix,
  nix-prefetch-git,
  nodejs_24,
  prefetch-npm-deps,
  stdenv,
}:

let
  manifest = builtins.fromJSON (builtins.readFile ./deno.json);
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [
      ./deno.json
      ./deno.lock
      ./src
    ];
  };
in
buildDenoPackage {
  pname = "nix-repin";
  inherit (manifest) version;
  inherit src;

  denoDepsHash = "sha256-9y2HHn24tbZ7UP5A52RPnEyOBLcQh6IKwXHQLgoatck=";
  dontBuild = true;
  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/bin" "$out/share/nix-repin"
    cp -r . "$out/share/nix-repin"
    # Deno looks up the bundled npm packages by registry, so ~/.npmrc must not change it.
    echo "registry=https://registry.npmjs.org/" > "$out/share/nix-repin/.npmrc"
    # With a scoped --allow-run, Deno refuses to spawn programs while any LD_* or DYLD_* variable is set.
    makeWrapper ${lib.getExe deno} "$out/bin/nix-repin" \
      --add-flags "run --cached-only --frozen --no-code-cache --no-prompt --vendor=true --config $out/share/nix-repin/deno.json --allow-env=GH_TOKEN,GITHUB_TOKEN --allow-net --allow-read --allow-run=${lib.getExe git},${lib.getExe nix},${lib.getExe nix-prefetch-git},${lib.getExe' nodejs_24 "npm"},${lib.getExe prefetch-npm-deps} --allow-write $out/share/nix-repin/src/cli.ts" \
      --run 'unset "''${!LD_@}" "''${!DYLD_@}"' \
      --set DENO_DIR "$out/share/nix-repin/.deno" \
      --set PATH ${
        lib.makeBinPath (
          [
            coreutils
            git
            nix
            nix-prefetch-git
            nodejs_24
            prefetch-npm-deps
          ]
          # Flutter runs sw_vers on macOS.
          ++ lib.optionals stdenv.hostPlatform.isDarwin [ darwin.DarwinTools ]
        )
      }

    runHook postInstall
  '';

  meta = {
    description = "Update Nix package sources from typed TypeScript definitions";
    homepage = "https://github.com/so1ve/nix-repin";
    license = lib.licenses.mit;
    mainProgram = "nix-repin";
    platforms = lib.platforms.unix;
  };
}
