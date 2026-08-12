{
  buildDenoPackage,
  deno,
  lib,
  makeWrapper,
  nix,
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

  denoDepsHash = "sha256-Oij+JjrIV8m5u4cBhtuGsBsQHcWNQ9RYmxA6rQF93nY=";
  dontBuild = true;
  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/bin" "$out/share/nix-repin"
    cp -r . "$out/share/nix-repin"
    makeWrapper ${lib.getExe deno} "$out/bin/nix-repin" \
      --add-flags "run --cached-only --frozen --no-code-cache --no-prompt --vendor=true --config $out/share/nix-repin/deno.json --allow-env=GH_TOKEN,GITHUB_TOKEN --allow-net --allow-read --allow-run=${lib.getExe nix} --allow-write $out/share/nix-repin/src/cli.ts" \
      --set DENO_DIR "$out/share/nix-repin/.deno" \
      --set PATH ${lib.makeBinPath [ nix ]}

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
