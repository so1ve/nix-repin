{ inputs, pkgs, ... }:

{
  overlays = [ inputs.js-toolchain-overlay.overlays.default ];

  languages.javascript = {
    enable = true;
    package = pkgs.node-bin.fromProject ./.;
    npm.enable = true;
    lsp.package = pkgs.vtsls;
  };

  packages = [
    pkgs.git
    pkgs.nix-prefetch-git
    pkgs.prettierd
    pkgs.vscode-langservers-extracted
  ];
}
