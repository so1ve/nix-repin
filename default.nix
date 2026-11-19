{
  buildNpmPackage,
  coreutils,
  crane,
  darwin,
  git,
  lib,
  makeWrapper,
  nix,
  nix-prefetch-git,
  nodejs_26,
  prefetch-npm-deps,
  stdenv,
}:

let
  manifest = builtins.fromJSON (builtins.readFile ./package.json);
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [
      ./package.json
      ./package-lock.json
      ./tsconfig.json
      ./tsconfig.build.json
      ./src
    ];
  };
in
buildNpmPackage {
  pname = "nix-repin";
  inherit (manifest) version;
  inherit src;

  nodejs = nodejs_26;
  npmDepsHash = "sha256-1OF4YIGWJtVgrWMKmWDclJcDWlzowwYUrJ6rWCBghMo=";
  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall

    npm prune --omit=dev

    mkdir -p "$out/bin" "$out/share/nix-repin"
    cp -r package.json src types node_modules "$out/share/nix-repin"
    rm -rf "$out/share/nix-repin/src"/*_test.ts \
      "$out/share/nix-repin/src/providers"/*_test.ts \
      "$out/share/nix-repin/src/test_support.ts"

    makeWrapper ${lib.getExe nodejs_26} "$out/bin/nix-repin" \
      --add-flags "$out/share/nix-repin/src/cli.ts" \
      --set PATH ${
        lib.makeBinPath (
          [
            coreutils
            crane
            git
            nix
            nix-prefetch-git
            nodejs_26
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
