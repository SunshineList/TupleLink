// SPDX-License-Identifier: AGPL-3.0-only
package graphql

import (
	"context"
	"github.com/daeuniverse/dae-wing/graphql/service/node"
	"github.com/graph-gophers/graphql-go"
)

func (r *MutationResolver) TestNodeUDP(ctx context.Context, args struct{ ID graphql.ID }) (*node.UDPTestResolver, error) {
	return node.TestNodeUDP(ctx, args.ID)
}
