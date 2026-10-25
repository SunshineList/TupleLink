// SPDX-License-Identifier: AGPL-3.0-only
package graphql

import (
	"context"
	"github.com/daeuniverse/dae-wing/dae"
)

func (r *MutationResolver) ActivateGeodata(ctx context.Context, args struct{ Target, Previous string }) (int32, error) {
	if err := dae.ActivateRouterGeodata(ctx, args.Target, args.Previous); err != nil {
		return 0, err
	}
	return 1, nil
}
