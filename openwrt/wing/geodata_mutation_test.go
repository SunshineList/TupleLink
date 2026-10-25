package graphql

import (
	"context"
	"strings"
	"testing"
)

func TestRouterGeodataGraphQLSchemaAndAuthorization(t *testing.T) {
	schema, err := Schema()
	if err != nil {
		t.Fatal(err)
	}
	result := schema.Exec(context.Background(), `mutation{activateGeodata(target:"data-1",previous:"")}`, "", nil)
	if len(result.Errors) != 1 || !strings.Contains(result.Errors[0].Message, "access denied") {
		t.Fatalf("geodata activation is not admin protected: %v", result.Errors)
	}
}
