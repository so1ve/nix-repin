{ pkgs, ... }:

{
  languages.deno.enable = true;
  packages = [
    pkgs.git
    pkgs.nix-prefetch-git
  ];
}
