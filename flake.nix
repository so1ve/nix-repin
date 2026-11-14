{
  description = "Extensible source updater for Nix packages";

  nixConfig = {
    extra-substituters = [ "https://cache.so1ve.dev" ];
    extra-trusted-public-keys = [
      "cache.so1ve.dev-1:SijyzF9iE/VZwMXgMpd/HrNX9iItDZ1tdiNdeGakQGY="
    ];
  };

  inputs = {
    deno2nix = {
      url = "github:aMOPel/deno2nix/custom-made-fetcher";
      flake = false;
    };
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    {
      deno2nix,
      nixpkgs,
      self,
    }:
    let
      inherit (nixpkgs) lib;

      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = lib.genAttrs systems;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.callPackage ./default.nix {
            inherit ((import deno2nix { inherit pkgs; }).lib) buildDenoPackage;
          };
        }
      );

      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = lib.getExe self.packages.${system}.default;
          meta.description = "Update Nix package sources from TypeScript definitions";
        };
      });

      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt-tree);
    };
}
