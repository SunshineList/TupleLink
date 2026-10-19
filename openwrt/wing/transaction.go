// SPDX-License-Identifier: AGPL-3.0-only
package db

import "gorm.io/gorm"

// FinishTransaction must be deferred directly by a function with a named error
// result. It reports commit errors and never commits while unwinding a panic.
func FinishTransaction(tx *gorm.DB, result *error) {
	if failure := recover(); failure != nil {
		tx.Rollback()
		panic(failure)
	}
	if *result != nil {
		tx.Rollback()
		return
	}
	*result = tx.Commit().Error
	if *result != nil {
		tx.Rollback()
	}
}
