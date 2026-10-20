// SPDX-License-Identifier: AGPL-3.0-only
package graphql

import (
	"context"
	"strings"
	"testing"
)

func TestRouterUDPGraphQLSchemaAndAuthorization(t *testing.T) {
	schema, err := Schema()
	if err != nil {
		t.Fatal(err)
	}
	result := schema.Exec(context.Background(), `mutation {testNodeUDP(id:"invalid"){id alive target message}}`, "", nil)
	if len(result.Errors) != 1 || !strings.Contains(result.Errors[0].Message, "access denied") {
		t.Fatalf("UDP diagnostic is not admin protected: %v", result.Errors)
	}
}
